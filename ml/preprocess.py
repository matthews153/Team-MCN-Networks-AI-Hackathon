"""Signal preprocessing, quality checks and rhythm measurements.

Used by both the training pipeline and the inference backend so that an
uploaded ECG goes through exactly the same transformations as training data.
"""
from __future__ import annotations

import numpy as np
from scipy import signal as sps

from .config import BANDPASS, N_SAMPLES, SAMPLING_RATE, LEADS


def resample_to_target(x: np.ndarray, fs: float) -> np.ndarray:
    """x: (T, 12) at fs Hz -> (N_SAMPLES, 12) at SAMPLING_RATE Hz (crop/pad to 10 s)."""
    x = np.asarray(x, dtype=np.float32)
    if abs(fs - SAMPLING_RATE) > 1e-6:
        n_new = int(round(x.shape[0] * SAMPLING_RATE / fs))
        x = sps.resample_poly(x, SAMPLING_RATE, int(round(fs)), axis=0) if float(fs).is_integer() \
            else sps.resample(x, n_new, axis=0)
    if x.shape[0] >= N_SAMPLES:
        start = (x.shape[0] - N_SAMPLES) // 2
        x = x[start:start + N_SAMPLES]
    else:
        pad = N_SAMPLES - x.shape[0]
        x = np.pad(x, ((0, pad), (0, 0)), mode="edge")
    return x.astype(np.float32)


_SOS = sps.butter(3, BANDPASS, btype="bandpass", fs=SAMPLING_RATE, output="sos")


def bandpass(x: np.ndarray) -> np.ndarray:
    """Zero-phase band-pass along time axis. x: (..., T, 12)."""
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    return sps.sosfiltfilt(_SOS, x, axis=-2).astype(np.float32)


def standardize(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((x - mean) / std).astype(np.float32)


# --------------------------------------------------------------------------- #
# Signal quality
# --------------------------------------------------------------------------- #
def signal_quality(raw: np.ndarray) -> dict:
    """Heuristic signal-quality assessment on a (N_SAMPLES, 12) raw (mV) ECG.

    Flags flat/missing leads, amplitude clipping, high-frequency noise and
    baseline wander. Returns an overall 0-100 score, a grade and per-lead detail.
    """
    fs = SAMPLING_RATE
    per_lead = []
    issues = []
    for i, name in enumerate(LEADS):
        s = raw[:, i].astype(np.float64)
        ptp = float(np.ptp(s))
        std = float(np.std(s))
        lead_issues = []
        score = 100.0

        if std < 0.01 or ptp < 0.05:
            lead_issues.append("flat / disconnected")
            score -= 70
        # clipping: many samples stuck at the extreme values
        if ptp > 0:
            at_max = np.mean(np.isclose(s, s.max(), atol=ptp * 0.002))
            at_min = np.mean(np.isclose(s, s.min(), atol=ptp * 0.002))
            if at_max > 0.04 or at_min > 0.04:
                lead_issues.append("amplitude clipping")
                score -= 30
        if ptp > 8.0:
            lead_issues.append("implausible amplitude")
            score -= 30
        # baseline wander: power below 0.5 Hz relative to total
        f, p = sps.welch(s - s.mean(), fs=fs, nperseg=min(512, len(s)))
        total = p.sum() + 1e-12
        low = p[f < 0.5].sum() / total
        high = p[f > 35].sum() / total
        if low > 0.5 and std >= 0.01:
            lead_issues.append("baseline wander")
            score -= 20
        if high > 0.25 and std >= 0.01:
            lead_issues.append("high-frequency noise")
            score -= 25
        score = max(0.0, score)
        per_lead.append({"lead": name, "score": round(score, 1), "issues": lead_issues,
                         "noise_ratio": round(float(high), 3), "wander_ratio": round(float(low), 3)})
        for iss in lead_issues:
            issues.append(f"{name}: {iss}")

    overall = float(np.mean([l["score"] for l in per_lead]))
    n_flat = sum("flat / disconnected" in l["issues"] for l in per_lead)
    if n_flat >= 3:
        overall = min(overall, 40.0)
    grade = "good" if overall >= 85 else "acceptable" if overall >= 65 else "poor"
    return {"score": round(overall, 1), "grade": grade, "issues": issues, "per_lead": per_lead}


# --------------------------------------------------------------------------- #
# Rhythm / basic intervals
# --------------------------------------------------------------------------- #
def rhythm_metrics(raw: np.ndarray) -> dict:
    """Simple R-peak detection on a lead-II-dominant composite to get HR and RR stats."""
    fs = SAMPLING_RATE
    filt = bandpass(raw[None])[0]
    # composite: energy of leads II, V2, V5 derivative -> robust to lead polarity
    idx = [LEADS.index(l) for l in ("II", "V2", "V5")]
    comp = np.sum(np.abs(np.diff(filt[:, idx], axis=0)), axis=1)
    comp = np.convolve(comp, np.ones(3) / 3, mode="same")
    if comp.max() <= 0:
        return {"heart_rate": None, "rr_mean_ms": None, "rr_sdnn_ms": None, "irregular": None,
                "r_peaks": [], "rhythm_note": "Unable to detect beats"}
    peaks, _ = sps.find_peaks(comp, height=0.35 * np.percentile(comp, 99),
                              distance=int(0.3 * fs))
    if len(peaks) < 3:
        return {"heart_rate": None, "rr_mean_ms": None, "rr_sdnn_ms": None, "irregular": None,
                "r_peaks": peaks.tolist(), "rhythm_note": "Too few beats detected"}
    rr = np.diff(peaks) / fs * 1000.0
    hr = 60000.0 / rr.mean()
    sdnn = float(rr.std())
    cv = sdnn / rr.mean()
    irregular = bool(cv > 0.15)
    if hr < 50:
        note = "Bradycardia range"
    elif hr > 100:
        note = "Tachycardia range"
    else:
        note = "Rate within normal range"
    if irregular:
        note += "; irregular RR intervals"
    return {"heart_rate": round(float(hr), 1), "rr_mean_ms": round(float(rr.mean()), 1),
            "rr_sdnn_ms": round(sdnn, 1), "irregular": irregular, "r_peaks": peaks.tolist(),
            "rhythm_note": note}
