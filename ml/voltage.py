"""Classic ECG voltage criteria for left ventricular hypertrophy (LVH).

A transparent, rule-based check that runs next to the AI: it measures the height of the
R waves and depth of the S waves in specific leads and compares them with the two most
widely used criteria:

  * Sokolow-Lyon:   S(V1) + max(R(V5), R(V6))  >= 3.5 mV
  * Cornell voltage: R(aVL) + S(V3)  > 2.8 mV in men, > 2.0 mV in women

Amplitudes are measured beat by beat (QRS window around each detected beat, relative to
that beat's own baseline just before the QRS) and the median over beats is used, which is
more robust to noise and single odd beats than the overall maximum.

Voltage criteria are a rule of thumb, not a diagnosis: they miss many LVH cases and can be
met by healthy young, thin or athletic people.
"""
from __future__ import annotations

import numpy as np

from .config import LEADS, SAMPLING_RATE
from .preprocess import bandpass, rhythm_metrics

SOKOLOW_MV = 3.5
CORNELL_MV = {"M": 2.8, "F": 2.0}
BORDERLINE = 0.9   # within 10% below a cut-off counts as "borderline"
_L = {l: i for i, l in enumerate(LEADS)}


def _beat_amplitudes(filt: np.ndarray, peaks: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """Median R height and S depth (mV) per lead over all usable beats."""
    fs = SAMPLING_RATE
    half = int(0.08 * fs)                       # QRS window: +-80 ms around the beat
    b0, b1 = int(0.20 * fs), int(0.12 * fs)     # baseline: PR segment, 200-120 ms before
    R, S = [], []
    for p in peaks:
        if p - b0 < 0 or p + half >= filt.shape[0]:
            continue
        base = np.median(filt[p - b0:p - b1], axis=0)
        win = filt[p - half:p + half + 1] - base
        R.append(np.clip(win.max(0), 0, None))
        S.append(np.clip(-win.min(0), 0, None))
    if not R:
        return np.full(12, np.nan), np.full(12, np.nan)
    return np.median(R, 0), np.median(S, 0)


def lvh_voltage(raw: np.ndarray, sex: str | None = None, age: float | None = None,
                r_peaks: list[int] | None = None) -> dict:
    """raw: (1000, 12) ECG in mV at 100 Hz (as produced by resample_to_target)."""
    filt = bandpass(raw[None])[0]
    peaks = r_peaks if r_peaks is not None else rhythm_metrics(raw)["r_peaks"]
    R, S = _beat_amplitudes(filt, list(peaks))
    beats = int(sum(1 for p in peaks if p - int(0.2 * SAMPLING_RATE) >= 0
                    and p + int(0.08 * SAMPLING_RATE) < filt.shape[0]))
    if beats < 2 or np.isnan(R).all():
        return {"available": False, "reason": "Too few clean beats to measure wave heights."}

    sex_known = sex in ("M", "F")
    cornell_cut = CORNELL_MV[sex] if sex_known else CORNELL_MV["M"]
    v5_or_v6 = "V5" if R[_L["V5"]] >= R[_L["V6"]] else "V6"
    sok = float(S[_L["V1"]] + R[_L[v5_or_v6]])
    cor = float(R[_L["aVL"]] + S[_L["V3"]])
    out = {
        "available": True,
        "beats": beats,
        "sokolow": {"value": round(sok, 2), "cutoff": SOKOLOW_MV, "met": sok >= SOKOLOW_MV,
                    "parts": {"S_V1": round(float(S[_L["V1"]]), 2), f"R_{v5_or_v6}": round(float(R[_L[v5_or_v6]]), 2)}},
        "cornell": {"value": round(cor, 2), "cutoff": cornell_cut, "met": cor > cornell_cut,
                    "sex_used": sex if sex_known else None,
                    "parts": {"R_aVL": round(float(R[_L["aVL"]]), 2), "S_V3": round(float(S[_L["V3"]]), 2)}},
    }
    out["met"] = out["sokolow"]["met"] or out["cornell"]["met"]
    for k in ("sokolow", "cornell"):
        c = out[k]
        c["borderline"] = (not c["met"]) and c["value"] >= BORDERLINE * c["cutoff"]
    out["borderline"] = (not out["met"]) and (out["sokolow"]["borderline"] or out["cornell"]["borderline"])
    out["status"] = "met" if out["met"] else "borderline" if out["borderline"] else "not_met"
    notes = []
    if not sex_known:
        notes.append("Sex not given — Cornell used the men's cut-off (2.8 mV); for women it is 2.0 mV.")
    if age is not None and age < 35 and out["met"]:
        notes.append("High QRS voltage is common in healthy people under 35, so this is less specific.")
    out["notes"] = notes
    return out
