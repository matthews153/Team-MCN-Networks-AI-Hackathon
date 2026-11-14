"""PTB-XL loading: metadata, superclass labels, raw 100 Hz signals (cached)."""
from __future__ import annotations

import ast

import numpy as np
import pandas as pd

from .config import CACHE_DIR, CLASSES, PTBXL_DIR


def load_metadata() -> pd.DataFrame:
    df = pd.read_csv(PTBXL_DIR / "ptbxl_database.csv", index_col="ecg_id")
    df["scp_codes"] = df["scp_codes"].apply(ast.literal_eval)
    scp = pd.read_csv(PTBXL_DIR / "scp_statements.csv", index_col=0)
    scp = scp[scp["diagnostic"] == 1]

    def to_super(codes: dict) -> list[str]:
        out = set()
        for code in codes:
            if code in scp.index:
                c = scp.loc[code, "diagnostic_class"]
                if isinstance(c, str):
                    out.add(c)
        return sorted(out)

    df["superclasses"] = df["scp_codes"].apply(to_super)
    for c in CLASSES:
        df[c] = df["superclasses"].apply(lambda s, c=c: int(c in s))
    df["age"] = df["age"].clip(upper=90)
    return df


def load_raw_signals(df: pd.DataFrame) -> np.ndarray:
    """Return float32 array (N, 1000, 12) in mV, cached to disk."""
    import wfdb

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / "signals100.npy"
    ids_cache = CACHE_DIR / "signals100_ids.npy"
    if cache.exists() and ids_cache.exists():
        ids = np.load(ids_cache)
        if len(ids) == len(df) and (ids == df.index.values).all():
            return np.load(cache, mmap_mode="r")
    sigs = np.zeros((len(df), 1000, 12), dtype=np.float32)
    for i, fn in enumerate(df["filename_lr"].values):
        sig, _ = wfdb.rdsamp(str(PTBXL_DIR / fn))
        sigs[i] = sig.astype(np.float32)
        if i % 2000 == 0:
            print(f"  loaded {i}/{len(df)} records", flush=True)
    np.save(cache, sigs)
    np.save(ids_cache, df.index.values)
    return sigs


# --------------------------------------------------------------------------- #
# English versions of the cardiologists' reports
# PTB-XL free-text reports are mostly German (some Swedish). Every report is also coded
# into standard SCP-ECG statements with English descriptions and a likelihood, so the
# English report is built from those codes rather than machine-translated.
_SCP_TEXT: dict | None = None
_CERTAINTY = {15: "unlikely", 35: "possible", 50: "possible", 80: "probable"}


def english_report(scp_codes: dict) -> str:
    """e.g. {'LVH': 50, 'ABQRS': 0, 'SR': 0} -> 'Possible left ventricular hypertrophy; abnormal QRS; sinus rhythm.'"""
    global _SCP_TEXT
    if _SCP_TEXT is None:
        s = pd.read_csv(PTBXL_DIR / "scp_statements.csv", index_col=0)
        _SCP_TEXT = {code: (str(row["description"]), 0 if row.get("diagnostic") == 1 else
                            1 if row.get("form") == 1 else 2) for code, row in s.iterrows()}
    items = []
    for code, lik in scp_codes.items():
        desc, kind = _SCP_TEXT.get(code, (code, 3))
        lik = int(lik or 0)
        qual = _CERTAINTY.get(lik) if kind == 0 else None   # likelihood is only given for diagnoses
        items.append((kind, -lik, f"{qual} {desc}" if qual else desc))
    parts = [t for _, _, t in sorted(items)]
    text = "; ".join(parts)
    return (text[:1].upper() + text[1:] + ".") if text else ""


def report_language(text: str) -> str:
    """Rough language of a PTB-XL free-text report: English, German or Swedish."""
    t = (text or "").lower()
    swedish = ("sinusrytm", "förlopp", "fÖrlopp", "vänster", "vÄnster", "avvikande", "el-axel", "kammar", "förmak")
    german = ("sinusrhythmus", "lagetyp", "normales", "ekg", "moeglich", "möglich", "mÖglich", "linkshypertrophie",
              "vorhof", "leitungsstoerung", "infarkt", "st-strecke", "rechtsschenkel", "linksschenkel")
    if any(w.lower() in t for w in swedish):
        return "Swedish"
    if any(w.lower() in t for w in german):
        return "German"
    return "English"
