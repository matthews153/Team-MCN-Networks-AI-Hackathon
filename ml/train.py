"""Train the CardioLens ECG ensemble on PTB-XL and write all evaluation artefacts.

Usage:
    python -m ml.train                 # 3-model ensemble, 30 epochs each
    python -m ml.train --models 1 --epochs 5   # quick smoke run

Outputs (in artifacts/):
    model_{k}.pt          trained ResNet1d weights
    norm.npz              per-lead mean/std used for standardisation
    metrics.json          held-out test metrics, baselines, curves, subgroups, failures
    samples.npz/.json     a library of unseen test-fold ECGs for the demo
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch
import torch.nn as nn
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, precision_recall_curve,
                             roc_auc_score, roc_curve)
from sklearn.preprocessing import StandardScaler

from .config import (ARTIFACTS_DIR, CLASSES, LEADS, TEST_FOLD,
                     TRAIN_FOLDS, VAL_FOLD, SAMPLING_RATE)
from .data import english_report, load_metadata, load_raw_signals, report_language
from .model import ResNet1d
from .preprocess import bandpass, standardize

ABN = [c for c in CLASSES if c != "NORM"]


def get_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


# --------------------------------------------------------------------------- #
# Training
# --------------------------------------------------------------------------- #
def augment(xb: torch.Tensor) -> torch.Tensor:
    """xb: (B, 12, T) standardised. Light, physiologically plausible augmentations."""
    B, C, T = xb.shape
    scale = torch.empty(B, C, 1, device=xb.device).uniform_(0.85, 1.15)
    xb = xb * scale
    xb = xb + 0.05 * torch.randn_like(xb)
    # baseline wander
    t = torch.linspace(0, 1, T, device=xb.device)
    freq = torch.empty(B, 1, 1, device=xb.device).uniform_(0.1, 0.5) * 10
    phase = torch.rand(B, 1, 1, device=xb.device) * 6.28
    amp = torch.empty(B, 1, 1, device=xb.device).uniform_(0, 0.2)
    xb = xb + amp * torch.sin(6.28 * freq * t + phase)
    # circular time shift
    shift = int(torch.randint(-80, 81, (1,)).item())
    return torch.roll(xb, shift, dims=-1)


@torch.no_grad()
def predict(model, X: np.ndarray, device, bs: int = 512) -> np.ndarray:
    model.eval()
    out = []
    for i in range(0, len(X), bs):
        xb = torch.from_numpy(np.ascontiguousarray(X[i:i + bs].transpose(0, 2, 1))).to(device)
        out.append(torch.sigmoid(model(xb)).cpu().numpy())
    return np.concatenate(out)


def train_one(seed, Xtr, Ytr, Xva, Yva, epochs, device, bs=128, lr=2e-3):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = ResNet1d(n_classes=len(CLASSES)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)
    steps = epochs * int(np.ceil(len(Xtr) / bs))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.25)
    loss_fn = nn.BCEWithLogitsLoss()
    Xtr_t = torch.from_numpy(np.ascontiguousarray(Xtr.transpose(0, 2, 1)))
    Ytr_t = torch.from_numpy(Ytr.astype(np.float32))
    best, best_state, history = -1, None, []
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr_t))
        t0, tot = time.time(), 0.0
        for i in range(0, len(perm), bs):
            idx = perm[i:i + bs]
            xb = augment(Xtr_t[idx].to(device))
            yb = Ytr_t[idx].to(device)
            loss = loss_fn(model(xb), yb)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item() * len(idx)
        pv = predict(model, Xva, device)
        val_loss = float(np.mean(-(Yva * np.log(pv + 1e-7) + (1 - Yva) * np.log(1 - pv + 1e-7))))
        auc = float(np.mean([roc_auc_score(Yva[:, j], pv[:, j]) for j in range(len(CLASSES))]))
        history.append({"epoch": ep + 1, "train_loss": round(tot / len(perm), 4),
                        "val_loss": round(val_loss, 4), "val_macro_auroc": round(auc, 4)})
        print(f"  [seed {seed}] epoch {ep+1:02d}/{epochs} loss={tot/len(perm):.4f} "
              f"val_loss={val_loss:.4f} val_auroc={auc:.4f} ({time.time()-t0:.0f}s)", flush=True)
        if auc > best:
            best = auc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    return model, history, best


# --------------------------------------------------------------------------- #
# Baseline: logistic regression on hand-crafted signal features
# --------------------------------------------------------------------------- #
def handcrafted_features(X: np.ndarray) -> np.ndarray:
    """X: (N, T, 12) band-passed mV -> (N, F)."""
    feats = [X.std(1), np.ptp(X, 1), stats.skew(X, axis=1), stats.kurtosis(X, axis=1),
             np.percentile(X, 5, axis=1), np.percentile(X, 95, axis=1),
             np.abs(np.diff(X, axis=1)).mean(1)]
    F = np.fft.rfft(X, axis=1)
    P = np.abs(F) ** 2
    freqs = np.fft.rfftfreq(X.shape[1], 1 / SAMPLING_RATE)
    tot = P.sum(1) + 1e-9
    for lo, hi in [(0.5, 5), (5, 15), (15, 40)]:
        m = (freqs >= lo) & (freqs < hi)
        feats.append(P[:, m].sum(1) / tot)
    return np.nan_to_num(np.concatenate(feats, axis=1), nan=0.0, posinf=0.0, neginf=0.0)


# --------------------------------------------------------------------------- #
# Metrics helpers
# --------------------------------------------------------------------------- #
def tune_thresholds(Y, P):
    th = []
    for j in range(Y.shape[1]):
        best_f1, best_t = -1, 0.5
        for t in np.linspace(0.05, 0.95, 91):
            pred = P[:, j] >= t
            tp = np.sum(pred & (Y[:, j] == 1))
            fp = np.sum(pred & (Y[:, j] == 0))
            fn = np.sum(~pred & (Y[:, j] == 1))
            f1 = 2 * tp / max(1, 2 * tp + fp + fn)
            if f1 > best_f1:
                best_f1, best_t = f1, t
        th.append(float(round(best_t, 3)))
    return np.array(th)


def class_metrics(y, p, t):
    pred = p >= t
    tp = int(np.sum(pred & (y == 1)))
    fp = int(np.sum(pred & (y == 0)))
    fn = int(np.sum(~pred & (y == 1)))
    tn = int(np.sum(~pred & (y == 0)))
    sens = tp / max(1, tp + fn)
    spec = tn / max(1, tn + fp)
    ppv = tp / max(1, tp + fp)
    npv = tn / max(1, tn + fn)
    f1 = 2 * tp / max(1, 2 * tp + fp + fn)
    try:
        auroc = float(roc_auc_score(y, p))
        auprc = float(average_precision_score(y, p))
    except ValueError:
        auroc = auprc = float("nan")
    return {"auroc": auroc, "auprc": auprc, "sensitivity": sens, "specificity": spec,
            "ppv": ppv, "npv": npv, "f1": f1, "accuracy": (tp + tn) / max(1, len(y)),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn, "n_pos": int(y.sum()), "threshold": float(t)}


def summarize(Y, P, th):
    per = {c: class_metrics(Y[:, j], P[:, j], th[j]) for j, c in enumerate(CLASSES)}
    macro = {k: float(np.nanmean([per[c][k] for c in CLASSES]))
             for k in ("auroc", "auprc", "f1", "sensitivity", "specificity")}
    return {"per_class": per, "macro": macro}


def binary_summary(Y, P, th):
    """Normal vs abnormal: abnormal if any of the 4 abnormal classes is predicted."""
    ab_idx = [CLASSES.index(c) for c in ABN]
    y_ab = (Y[:, ab_idx].sum(1) > 0).astype(int)
    p_ab = (P[:, ab_idx] >= th[ab_idx]).any(1)
    score = (P[:, ab_idx] / th[ab_idx]).max(1)  # >1 means flagged
    tp = int(np.sum(p_ab & (y_ab == 1)))
    fp = int(np.sum(p_ab & (y_ab == 0)))
    fn = int(np.sum(~p_ab & (y_ab == 1)))
    tn = int(np.sum(~p_ab & (y_ab == 0)))
    majority = int(y_ab.mean() >= 0.5)
    return {"confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
            "accuracy": (tp + tn) / len(y_ab), "sensitivity": tp / max(1, tp + fn),
            "specificity": tn / max(1, tn + fp), "auroc": float(roc_auc_score(y_ab, score)),
            "majority_baseline": {"predicts": "abnormal" if majority else "normal",
                                  "accuracy": float(max(y_ab.mean(), 1 - y_ab.mean()))},
            "prevalence_abnormal": float(y_ab.mean())}


def curves(Y, P, n=60):
    out = {}
    for j, c in enumerate(CLASSES):
        fpr, tpr, _ = roc_curve(Y[:, j], P[:, j])
        idx = np.unique(np.linspace(0, len(fpr) - 1, n).astype(int))
        prec, rec, _ = precision_recall_curve(Y[:, j], P[:, j])
        idx2 = np.unique(np.linspace(0, len(prec) - 1, n).astype(int))
        out[c] = {"roc": [{"fpr": round(float(fpr[i]), 4), "tpr": round(float(tpr[i]), 4)} for i in idx],
                  "pr": [{"recall": round(float(rec[i]), 4), "precision": round(float(prec[i]), 4)}
                         for i in idx2]}
    return out


def calibration(Y, P, bins=10):
    out = {}
    edges = np.linspace(0, 1, bins + 1)
    for j, c in enumerate(CLASSES):
        rows = []
        for b in range(bins):
            m = (P[:, j] >= edges[b]) & (P[:, j] < edges[b + 1] + (1e-9 if b == bins - 1 else 0))
            if m.sum() >= 5:
                rows.append({"bin": round(float((edges[b] + edges[b + 1]) / 2), 2),
                             "predicted": round(float(P[m, j].mean()), 4),
                             "observed": round(float(Y[m, j].mean()), 4), "n": int(m.sum())})
        out[c] = rows
    return out


def subgroups(meta, Y, P, th):
    groups = {
        "Male": meta["sex"].values == 0, "Female": meta["sex"].values == 1,
        "Age <40": meta["age"].values < 40,
        "Age 40-59": (meta["age"].values >= 40) & (meta["age"].values < 60),
        "Age 60-74": (meta["age"].values >= 60) & (meta["age"].values < 75),
        "Age 75+": meta["age"].values >= 75,
    }
    out = []
    for name, m in groups.items():
        if m.sum() < 30:
            continue
        s = summarize(Y[m], P[m], th)
        row = {"group": name, "n": int(m.sum()), "macro_auroc": s["macro"]["auroc"],
               "macro_f1": s["macro"]["f1"]}
        for c in CLASSES:
            row[f"sens_{c}"] = s["per_class"][c]["sensitivity"]
            row[f"spec_{c}"] = s["per_class"][c]["specificity"]
            row[f"auroc_{c}"] = s["per_class"][c]["auroc"]
        out.append(row)
    return out


def to_jsonable(o):
    if isinstance(o, dict):
        return {k: to_jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [to_jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if np.isnan(o) else round(float(o), 4)
    if isinstance(o, np.integer):
        return int(o)
    return o


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=int, default=3, help="ensemble size")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--bs", type=int, default=128)
    args = ap.parse_args()

    ARTIFACTS_DIR.mkdir(exist_ok=True)
    device = get_device()
    print(f"Device: {device}")

    print("Loading metadata + signals ...")
    meta = load_metadata()
    raw_all = load_raw_signals(meta)
    keep = meta["superclasses"].apply(len).values > 0   # drop ECGs with no diagnostic label
    meta = meta[keep]
    raw_all = np.asarray(raw_all)[keep]
    Y_all = meta[CLASSES].values.astype(np.float32)
    print(f"  {len(meta)} labelled ECGs")

    filt = bandpass(raw_all)
    tr = meta["strat_fold"].isin(TRAIN_FOLDS).values
    va = (meta["strat_fold"] == VAL_FOLD).values
    te = (meta["strat_fold"] == TEST_FOLD).values
    mean = filt[tr].mean(axis=(0, 1)).astype(np.float32)
    std = filt[tr].std(axis=(0, 1)).astype(np.float32) + 1e-6
    np.savez(ARTIFACTS_DIR / "norm.npz", mean=mean, std=std)
    X_all = standardize(filt, mean, std)

    Xtr, Ytr = X_all[tr], Y_all[tr]
    Xva, Yva = X_all[va], Y_all[va]
    Xte, Yte = X_all[te], Y_all[te]
    print(f"  train={len(Xtr)} val={len(Xva)} test={len(Xte)}")

    # ---------------- baselines ----------------
    print("Training logistic-regression baseline on hand-crafted features ...")
    Ftr, Fva, Fte = (handcrafted_features(filt[m]) for m in (tr, va, te))
    sc = StandardScaler().fit(Ftr)
    Pva_lr = np.zeros_like(Yva)
    Pte_lr = np.zeros_like(Yte)
    for j in range(len(CLASSES)):
        lr = LogisticRegression(max_iter=2000, C=0.5).fit(sc.transform(Ftr), Ytr[:, j])
        Pva_lr[:, j] = lr.predict_proba(sc.transform(Fva))[:, 1]
        Pte_lr[:, j] = lr.predict_proba(sc.transform(Fte))[:, 1]
    th_lr = tune_thresholds(Yva, Pva_lr)
    prev = Ytr.mean(0)
    P_prev = np.tile(prev, (len(Yte), 1))
    th_prev = np.full(len(CLASSES), 0.5)

    # ---------------- ensemble ----------------
    histories, Pva_list, Pte_list = [], [], []
    for k in range(args.models):
        print(f"Training ResNet1d model {k+1}/{args.models} ...")
        model, hist, best = train_one(42 + k, Xtr, Ytr, Xva, Yva, args.epochs, device, bs=args.bs)
        torch.save(model.state_dict(), ARTIFACTS_DIR / f"model_{k}.pt")
        histories.append(hist)
        Pva_list.append(predict(model, Xva, device))
        Pte_list.append(predict(model, Xte, device))
    Pva = np.mean(Pva_list, 0)
    Pte = np.mean(Pte_list, 0)
    th = tune_thresholds(Yva, Pva)
    print("Thresholds:", dict(zip(CLASSES, th)))

    model_summary = summarize(Yte, Pte, th)
    single_summary = summarize(Yte, Pte_list[0], tune_thresholds(Yva, Pva_list[0]))
    print("Test macro AUROC (ensemble):", round(model_summary["macro"]["auroc"], 4))

    # failure analysis: largest absolute error on the test set
    err = np.abs(Yte - Pte).max(1)
    te_meta = meta[te]
    fail_idx = np.argsort(-err)[:25]
    failures = []
    for i in fail_idx:
        failures.append({"ecg_id": int(te_meta.index[i]),
                         "true": [c for j, c in enumerate(CLASSES) if Yte[i, j] == 1],
                         "pred": [c for j, c in enumerate(CLASSES) if Pte[i, j] >= th[j]],
                         "probs": {c: float(Pte[i, j]) for j, c in enumerate(CLASSES)},
                         "age": float(te_meta["age"].iloc[i]),
                         "sex": "F" if te_meta["sex"].iloc[i] == 1 else "M",
                         "report": str(te_meta["report"].iloc[i]),
                         "report_en": english_report(te_meta["scp_codes"].iloc[i]),
                         "report_lang": report_language(str(te_meta["report"].iloc[i]))})

    # dataset analytics
    cooc = (Y_all.T @ Y_all).astype(int).tolist()
    split_counts = {name: {c: int(Y_all[m, j].sum()) for j, c in enumerate(CLASSES)}
                    for name, m in (("train", tr), ("val", va), ("test", te))}
    age_hist = np.histogram(meta["age"].dropna(), bins=range(0, 100, 10))[0].tolist()

    metrics = {
        "classes": CLASSES, "leads": LEADS,
        "created": time.strftime("%Y-%m-%d %H:%M"),
        "device": str(device), "ensemble_size": args.models, "epochs": args.epochs,
        "n": {"train": int(tr.sum()), "val": int(va.sum()), "test": int(te.sum()),
              "total_labelled": int(len(meta))},
        "thresholds": dict(zip(CLASSES, th.tolist())),
        "ensemble": model_summary,
        "single_model": single_summary,
        "baselines": {
            "prevalence": summarize(Yte, P_prev, th_prev),
            "logreg_features": summarize(Yte, Pte_lr, th_lr),
        },
        "binary": binary_summary(Yte, Pte, th),
        "binary_logreg": binary_summary(Yte, Pte_lr, th_lr),
        "curves": curves(Yte, Pte),
        "calibration": calibration(Yte, Pte),
        "subgroups": subgroups(te_meta, Yte, Pte, th),
        "history": histories,
        "failures": failures,
        "dataset": {"cooccurrence": cooc, "split_counts": split_counts,
                    "age_hist": {"bins": list(range(0, 90, 10)), "counts": age_hist},
                    "sex_counts": {"M": int((meta["sex"] == 0).sum()), "F": int((meta["sex"] == 1).sum())}},
    }
    with open(ARTIFACTS_DIR / "metrics.json", "w") as f:
        json.dump(to_jsonable(metrics), f)

    # ---------------- demo sample library (unseen test fold) ----------------
    rng = np.random.default_rng(0)
    chosen = []
    for c in CLASSES:  # single-label examples per class
        cand = np.where((Yte[:, CLASSES.index(c)] == 1) & (Yte.sum(1) == 1))[0]
        chosen += rng.choice(cand, size=min(6, len(cand)), replace=False).tolist()
    multi = np.where(Yte.sum(1) >= 2)[0]
    chosen += rng.choice(multi, size=min(8, len(multi)), replace=False).tolist()
    chosen += [int(i) for i in fail_idx[:8]]
    chosen = list(dict.fromkeys(chosen))
    raw_te = raw_all[te]
    sig = raw_te[chosen].astype(np.float32)
    np.savez_compressed(ARTIFACTS_DIR / "samples.npz", signals=sig)
    index = []
    for k, i in enumerate(chosen):
        index.append({"idx": k, "ecg_id": int(te_meta.index[i]),
                      "age": float(te_meta["age"].iloc[i]) if not np.isnan(te_meta["age"].iloc[i]) else None,
                      "sex": "F" if te_meta["sex"].iloc[i] == 1 else "M",
                      "true_labels": [c for j, c in enumerate(CLASSES) if Yte[i, j] == 1],
                      "is_failure_case": bool(i in fail_idx[:8]),
                      "report": str(te_meta["report"].iloc[i]),
                      "report_en": english_report(te_meta["scp_codes"].iloc[i]),
                      "report_lang": report_language(str(te_meta["report"].iloc[i]))})
    with open(ARTIFACTS_DIR / "samples.json", "w") as f:
        json.dump(index, f)
    print(f"Saved {len(chosen)} demo samples. Done.")


if __name__ == "__main__":
    main()
