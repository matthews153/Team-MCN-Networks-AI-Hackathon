"""Recompute the threshold-dependent test metrics in artifacts/metrics.json — no retraining.

Use this after changing a decision threshold, so Model insights and the app stay consistent:

    python -m ml.recompute_metrics                 # use the thresholds already in metrics.json
    python -m ml.recompute_metrics --set HYP=0.2   # change one or more thresholds first

It re-runs the saved ensemble on the held-out test fold and rewrites the parts that depend on
the thresholds: per-class/macro ensemble metrics, normal-vs-abnormal confusion matrix,
fairness subgroups and the predictions listed for the hardest cases. Threshold-free parts
(ROC/PR curves, AUROC, calibration, baselines, training history) are checked, not changed.
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch

from .config import ARTIFACTS_DIR, CLASSES, TEST_FOLD
from .data import load_metadata, load_raw_signals
from .model import ResNet1d
from .preprocess import bandpass, standardize
from .train import binary_summary, subgroups, summarize, to_jsonable


def predict_test():
    meta = load_metadata()
    raw = load_raw_signals(meta)
    keep = meta["superclasses"].apply(len).values > 0          # same filtering as ml.train
    meta, raw = meta[keep], np.asarray(raw)[keep]
    te = (meta["strat_fold"] == TEST_FOLD).values
    n = np.load(ARTIFACTS_DIR / "norm.npz")
    X = standardize(bandpass(raw[te]), n["mean"], n["std"]).transpose(0, 2, 1)
    X = np.ascontiguousarray(X, dtype=np.float32)
    P = []
    for path in sorted(ARTIFACTS_DIR.glob("model_*.pt")):
        m = ResNet1d(n_classes=len(CLASSES))
        m.load_state_dict(torch.load(path, map_location="cpu"))
        m.eval()
        with torch.no_grad():
            P.append(np.concatenate([torch.sigmoid(m(torch.from_numpy(X[i:i + 256]))).numpy()
                                     for i in range(0, len(X), 256)]))
    return meta[te], meta[CLASSES].values[te].astype(np.float32), np.mean(P, 0), len(P)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--set", nargs="*", default=[], metavar="CLASS=VALUE",
                    help="override thresholds, e.g. --set HYP=0.2 MI=0.3")
    args = ap.parse_args()

    path = ARTIFACTS_DIR / "metrics.json"
    metrics = json.loads(path.read_text())
    th_map = dict(metrics["thresholds"])
    for item in args.set:
        c, v = item.split("=")
        if c not in CLASSES:
            raise SystemExit(f"Unknown class {c!r}; choose from {CLASSES}")
        th_map[c] = float(v)
    th = np.array([th_map[c] for c in CLASSES], dtype=float)

    print("Running the saved ensemble on the test fold ...")
    te_meta, Y, P, n_models = predict_test()

    # sanity check: threshold-free numbers must match what training reported
    new = summarize(Y, P, th)
    for c in CLASSES:
        old_auc = metrics["ensemble"]["per_class"][c]["auroc"]
        if abs(new["per_class"][c]["auroc"] - old_auc) > 2e-3:
            raise SystemExit(f"AUROC for {c} is {new['per_class'][c]['auroc']:.4f} but metrics.json says "
                             f"{old_auc:.4f} — the saved models don't match these metrics; retrain instead.")

    before = {c: metrics["ensemble"]["per_class"][c] for c in CLASSES}
    metrics["thresholds"] = dict(zip(CLASSES, th.tolist()))
    metrics["ensemble"] = new
    metrics["binary"] = binary_summary(Y, P, th)
    metrics["subgroups"] = subgroups(te_meta, Y, P, th)
    pos = {int(e): i for i, e in enumerate(te_meta.index)}
    for f in metrics.get("failures", []):
        i = pos.get(f["ecg_id"])
        if i is not None:
            f["pred"] = [c for j, c in enumerate(CLASSES) if P[i, j] >= th[j]]
    metrics["thresholds_updated"] = time.strftime("%Y-%m-%d %H:%M")
    path.write_text(json.dumps(to_jsonable(metrics)))

    print(f"\nUpdated {path.relative_to(ARTIFACTS_DIR.parent)} ({n_models}-model ensemble, {len(Y)} test ECGs)")
    print(f"{'class':6} {'threshold':>17} {'sensitivity':>17} {'PPV':>17}")
    for c in CLASSES:
        o, n_ = before[c], new["per_class"][c]
        print(f"{c:6} {o['threshold']:>7.2f} -> {n_['threshold']:<7.2f} {o['sensitivity']:>7.1%} -> {n_['sensitivity']:<7.1%}"
              f" {o['ppv']:>7.1%} -> {n_['ppv']:<7.1%}")
    b = metrics["binary"]
    print(f"Normal vs abnormal: sensitivity {b['sensitivity']:.1%}, specificity {b['specificity']:.1%}, "
          f"accuracy {b['accuracy']:.1%} (missed {b['confusion']['fn']}, false alarms {b['confusion']['fp']})")


if __name__ == "__main__":
    main()
