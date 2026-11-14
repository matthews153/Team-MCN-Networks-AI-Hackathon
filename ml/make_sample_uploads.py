"""Export a handful of unseen PTB-XL test-fold ECGs as upload-ready files.

Creates sample_uploads/ with:
  * WFDB 500 Hz records (.hea + .dat) — the native PTB-XL format
  * CSV files (12 lead columns, 500 Hz) — what a typical ECG cart export looks like
"""
import shutil

import numpy as np
import wfdb

from .config import CLASSES, LEADS, PTBXL_DIR, TEST_FOLD, UPLOAD_EXAMPLES_DIR
from .data import load_metadata


def main():
    meta = load_metadata()
    te = meta[(meta["strat_fold"] == TEST_FOLD) & (meta["superclasses"].apply(len) == 1)]
    UPLOAD_EXAMPLES_DIR.mkdir(exist_ok=True)
    rng = np.random.default_rng(1)
    from backend.inference import Engine  # pick examples the trained ensemble reads correctly
    engine = Engine()
    for f in UPLOAD_EXAMPLES_DIR.glob("*_ecg*"):
        f.unlink()
    for c in CLASSES:
        rows = te[te[c] == 1]
        for k in rng.permutation(len(rows)):
            pick = rows.iloc[k]
            sig, _ = wfdb.rdsamp(str(PTBXL_DIR / pick["filename_lr"]))
            a = engine.analyze(sig, 100)
            ok = a["category"] == "normal" if c == "NORM" else a["flagged"] == [c]
            if ok and a["quality"]["grade"] != "poor":
                break
        eid = int(pick.name)
        src = PTBXL_DIR / pick["filename_hr"]
        stem = f"{c.lower()}_ecg{eid}"
        # WFDB copy (rename record so .hea references the new .dat name)
        rec = wfdb.rdrecord(str(src))
        wfdb.wrsamp(stem, fs=rec.fs, units=rec.units, sig_name=rec.sig_name,
                    p_signal=rec.p_signal, fmt=["16"] * 12, write_dir=str(UPLOAD_EXAMPLES_DIR))
        # CSV copy
        hdr = ",".join(LEADS)
        np.savetxt(UPLOAD_EXAMPLES_DIR / f"{stem}_fs500.csv", rec.p_signal, delimiter=",",
                   header=hdr, comments="", fmt="%.4f")
        print(f"{c}: ecg_id {eid} -> {stem}")
    shutil.copy(PTBXL_DIR / "LICENSE.txt", UPLOAD_EXAMPLES_DIR / "PTB-XL-LICENSE.txt") \
        if (PTBXL_DIR / "LICENSE.txt").exists() else None


if __name__ == "__main__":
    main()
