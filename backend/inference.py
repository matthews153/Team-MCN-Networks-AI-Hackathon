"""CardioLens inference engine: ensemble prediction, explanation, quality, triage."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from ml.config import ARTIFACTS_DIR, CLASSES, CLASS_INFO, LEADS, SAMPLING_RATE
from ml.model import ResNet1d
from ml.preprocess import bandpass, resample_to_target, rhythm_metrics, signal_quality, standardize
from ml.voltage import lvh_voltage

ABN = [c for c in CLASSES if c != "NORM"]
# How much each abnormal finding contributes to review priority (clinical urgency proxy)
URGENCY_WEIGHT = {"MI": 1.0, "STTC": 0.8, "CD": 0.7, "HYP": 0.55}
RED_FLAG_SYMPTOMS = {"chest pain", "syncope", "shortness of breath"}


class Engine:
    def __init__(self, artifacts: Path = ARTIFACTS_DIR):
        self.artifacts = artifacts
        self.models: list[ResNet1d] = []
        self.ready = False
        self.load()

    def load(self):
        paths = sorted(self.artifacts.glob("model_*.pt"))
        norm = self.artifacts / "norm.npz"
        metrics = self.artifacts / "metrics.json"
        if not paths or not norm.exists() or not metrics.exists():
            self.ready = False
            return
        self.models = []
        for p in paths:
            m = ResNet1d(n_classes=len(CLASSES))
            m.load_state_dict(torch.load(p, map_location="cpu"))
            m.eval()
            self.models.append(m)
        n = np.load(norm)
        self.mean, self.std = n["mean"], n["std"]
        with open(metrics) as f:
            self.metrics = json.load(f)
        self.th = np.array([self.metrics["thresholds"][c] for c in CLASSES])
        self.ready = True

    # ------------------------------------------------------------------ #
    def analyze(self, raw: np.ndarray, fs: float, patient: dict | None = None) -> dict:
        if not self.ready:
            raise RuntimeError("Model not trained yet. Run `python -m ml.train` first.")
        patient = patient or {}
        x_raw = resample_to_target(raw, fs)                     # (1000, 12) mV
        quality = signal_quality(x_raw)
        rhythm = rhythm_metrics(x_raw)
        x = standardize(bandpass(x_raw[None])[0], self.mean, self.std)
        xt = torch.from_numpy(np.ascontiguousarray(x.T))[None]  # (1, 12, 1000)

        probs_each = []
        attr = np.zeros((len(CLASSES), 12, x.shape[0]), dtype=np.float32)
        for m in self.models:
            inp = xt.clone().requires_grad_(True)
            logits = m(inp)
            probs_each.append(torch.sigmoid(logits).detach().numpy()[0])
            for j in range(len(CLASSES)):
                g, = torch.autograd.grad(logits[0, j], inp, retain_graph=j < len(CLASSES) - 1)
                attr[j] += (g * inp).detach().numpy()[0]
        probs_each = np.array(probs_each)                       # (M, 5)
        p = probs_each.mean(0)
        spread = probs_each.std(0)
        votes = (probs_each >= self.th).mean(0)
        attr /= len(self.models)

        flagged = [c for j, c in enumerate(CLASSES) if c != "NORM" and p[j] >= self.th[j]]
        flagged.sort(key=lambda c: -p[CLASSES.index(c)] / self.th[CLASSES.index(c)])

        # explanation for the most relevant class
        focus = flagged[0] if flagged else "NORM"
        fj = CLASSES.index(focus)
        sal = np.abs(attr[fj])                                    # (12, T)
        k = np.ones(9) / 9
        sal = np.array([np.convolve(s, k, mode="same") for s in sal])
        sal = sal / (sal.max() + 1e-9)
        lead_imp = np.abs(attr).sum(-1)                           # (5, 12)
        lead_imp = lead_imp / (lead_imp.sum(1, keepdims=True) + 1e-9)

        findings = []
        for j, c in enumerate(CLASSES):
            ratio = p[j] / self.th[j]
            pos = p[j] >= self.th[j]
            margin = abs(p[j] - self.th[j])
            conf = "high" if margin >= 0.3 else "moderate" if margin >= 0.12 else "low"
            top_leads = [LEADS[i] for i in np.argsort(-lead_imp[j])[:3]]
            findings.append({
                "code": c, "name": CLASS_INFO[c]["name"], "description": CLASS_INFO[c]["desc"],
                "probability": float(p[j]), "threshold": float(self.th[j]), "positive": bool(pos),
                "ratio": float(ratio), "confidence": conf, "model_spread": float(spread[j]),
                "model_votes": float(votes[j]), "per_model": probs_each[:, j].round(4).tolist(),
                "top_leads": top_leads,
                "test_sensitivity": self.metrics["ensemble"]["per_class"][c]["sensitivity"],
                "test_ppv": self.metrics["ensemble"]["per_class"][c]["ppv"],
            })

        uncertain = [f["code"] for f in findings
                     if (f["confidence"] == "low") or (0 < f["model_votes"] < 1)]
        voltage = lvh_voltage(x_raw, patient.get("sex"), _num(patient.get("age")), rhythm["r_peaks"])
        # how often a flag like this one was real hypertrophy on the test set (from ml.eval_voltage)
        lv = self.metrics.get("lvh_voltage")
        if lv and voltage.get("status") in ("met", "borderline") and "HYP" not in flagged:
            k = voltage["status"]
            hits, alarms = lv[f"ai_misses_{k}"], lv[f"extra_alarms_{k}"]
            voltage["test_hit_rate"] = {"hits": hits, "total": hits + alarms}
        triage = self._triage(p, flagged, quality, uncertain, patient, rhythm)
        add_voltage_note(triage, voltage, flagged)

        if flagged:
            headline = "Abnormal ECG — " + ", ".join(CLASS_INFO[c]["name"] for c in flagged)
            category = "abnormal"
        elif p[0] >= self.th[0]:
            headline = "Normal ECG"
            category = "normal"
        else:
            headline = "Borderline / indeterminate — no category reached its threshold"
            category = "indeterminate"

        return {
            "category": category,
            "headline": headline,
            "flagged": flagged,
            "focus_class": focus,
            "findings": findings,
            "uncertain": uncertain,
            "triage": triage,
            "quality": quality,
            "rhythm": rhythm,
            "narrative": self._narrative(flagged, findings, quality, rhythm, triage, uncertain, voltage),
            "lvh_voltage": voltage,
            "lead_importance": {c: lead_imp[j].round(4).tolist() for j, c in enumerate(CLASSES)},
            "saliency": sal.round(3).tolist(),                    # (12, 1000) for focus class
            "signal": x_raw.T.round(4).tolist(),                  # (12, 1000) mV
            "fs": SAMPLING_RATE, "leads": LEADS,
            "original_fs": float(fs), "original_samples": int(raw.shape[0]),
            "ensemble_size": len(self.models),
        }

    # ------------------------------------------------------------------ #
    def _triage(self, p, flagged, quality, uncertain, patient, rhythm):
        reasons = []
        score = 0.0
        for c in ABN:
            j = CLASSES.index(c)
            s = URGENCY_WEIGHT[c] * min(1.0, p[j] / max(self.th[j], 1e-6) * 0.6)
            score = max(score, s)
        score = 100 * score
        if len(flagged) >= 2:
            score += 8 * (len(flagged) - 1)
            reasons.append(f"{len(flagged)} co-existing abnormal categories")
        symptoms = {s.lower() for s in patient.get("symptoms", []) or []}
        red = symptoms & RED_FLAG_SYMPTOMS
        if red:
            score += 15
            reasons.append("Red-flag symptoms reported: " + ", ".join(sorted(red)))
        hr = rhythm.get("heart_rate")
        if hr and (hr < 45 or hr > 130):
            score += 12
            reasons.append(f"Heart rate {hr:.0f} bpm outside safe range")
        if rhythm.get("irregular"):
            score += 6
            reasons.append("Irregular RR intervals")
        score = float(min(100, round(score, 1)))

        mi = p[CLASSES.index("MI")]
        level = "routine"
        if ("MI" in flagged and (mi >= 0.7 or red)) or len(flagged) >= 3 or score >= 80:
            level = "urgent"
        elif flagged or red or (hr and (hr < 45 or hr > 130)):
            level = "priority"
        if quality["grade"] == "poor":
            reasons.append("Poor signal quality — repeat ECG recommended")
            if level == "routine":
                level = "priority"
        # keep the numeric score consistent with the level band
        band = {"urgent": (75, 100), "priority": (40, 74.9), "routine": (0, 39.9)}[level]
        score = float(round(min(max(score, band[0]), band[1]), 1))
        if uncertain and flagged:
            reasons.append("Model uncertainty on: " + ", ".join(uncertain))
        for c in flagged:
            reasons.insert(0, f"{CLASS_INFO[c]['name']} pattern (p={p[CLASSES.index(c)]:.2f})")
        if not reasons:
            reasons.append("No abnormal pattern detected above threshold")
        labels = {"urgent": "Urgent review", "priority": "Priority review", "routine": "Routine"}
        actions = {
            "urgent": "Review immediately. Consider directing the patient to the nearest emergency / "
                      "cardiac facility per local protocol.",
            "priority": "Review today. Correlate with symptoms and history; consider repeat ECG or referral.",
            "routine": "Routine review. AI found no high-priority pattern — this does not rule out disease.",
        }
        return {"level": level, "label": labels[level], "score": score, "reasons": reasons,
                "suggested_action": actions[level]}

    def _narrative(self, flagged, findings, quality, rhythm, triage, uncertain, voltage=None):
        parts = []
        hr = rhythm.get("heart_rate")
        if hr:
            parts.append(f"Estimated heart rate {hr:.0f} bpm ({rhythm['rhythm_note'].lower()}).")
        parts.append(f"Signal quality is {quality['grade']} ({quality['score']:.0f}/100).")
        fmap = {f["code"]: f for f in findings}
        if flagged:
            for c in flagged:
                f = fmap[c]
                parts.append(
                    f"The ensemble flags {f['name'].lower()} with probability {f['probability']:.0%} "
                    f"(threshold {f['threshold']:.0%}, {f['confidence']} confidence, "
                    f"{int(round(f['model_votes'] * 100))}% of models agree); most influential leads: "
                    f"{', '.join(f['top_leads'])}.")
        else:
            n = fmap["NORM"]
            parts.append(f"No abnormal category exceeded its decision threshold; normal-ECG "
                         f"probability is {n['probability']:.0%}.")
        if uncertain:
            parts.append("Borderline or disputed outputs for " + ", ".join(uncertain) +
                         " — interpret with caution.")
        if voltage and voltage.get("available"):
            parts.append(voltage_sentence(voltage, "HYP" in flagged))
        parts.append(f"AI review priority: {triage['label']} (score {triage['score']:.0f}/100).")
        parts.append("This is an AI-generated prototype interpretation and is not medical advice; "
                     "final interpretation rests with the reviewing clinician.")
        return " ".join(parts)


# --------------------------------------------------------------------------- #
# LVH voltage criteria: a rule-based safety net shown next to the AI
def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def voltage_summary(v: dict) -> str:
    met = [n for n, k in (("Sokolow-Lyon", "sokolow"), ("Cornell", "cornell")) if v[k]["met"]]
    near = [n for n, k in (("Sokolow-Lyon", "sokolow"), ("Cornell", "cornell")) if v[k].get("borderline")]
    show = met or near
    vals = ", ".join(f"{n} {v['sokolow' if n.startswith('S') else 'cornell']['value']:.1f} mV" for n in show)
    return vals


def voltage_sentence(v: dict, ai_hyp: bool) -> str:
    st = v.get("status")
    if st == "met":
        return (f"QRS voltage meets LVH criteria ({voltage_summary(v)})" +
                (" — consistent with the AI's hypertrophy finding." if ai_hyp else
                 " although the AI did not flag hypertrophy — consider checking for hypertrophy."))
    if st == "borderline":
        return (f"QRS voltage is borderline for LVH ({voltage_summary(v)}, within 10% of the cut-off)" +
                ("." if ai_hyp else " — the AI did not flag hypertrophy."))
    return ("QRS voltage is below LVH criteria" +
            (" — voltage criteria miss many cases of hypertrophy, so this does not contradict the AI." if ai_hyp else "."))


def add_voltage_note(triage: dict, v: dict, flagged: list) -> None:
    """Add a review reason when voltage criteria point to hypertrophy the AI did not flag.
    The review priority itself is left to the AI triage rule."""
    if not v.get("available") or "HYP" in flagged:
        return
    if v["status"] == "met":
        triage["reasons"].insert(len(flagged), f"Meets LVH voltage criteria ({voltage_summary(v)}) — AI did not flag hypertrophy")
    elif v["status"] == "borderline":
        triage["reasons"].append(f"Borderline LVH voltage ({voltage_summary(v)})")
    else:
        return
    none = "No abnormal pattern detected above threshold"
    if none in triage["reasons"]:
        triage["reasons"].remove(none)
