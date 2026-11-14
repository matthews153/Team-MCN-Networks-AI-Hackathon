"""Evaluate the LVH voltage-criteria check on the held-out test fold and store the results
in artifacts/metrics.json (shown on Model insights).

    python -m ml.eval_voltage

Compares, for the hypertrophy (HYP) category: the AI alone, voltage criteria alone, and the
AI with voltage criteria as a safety net (flag if either says so).
"""
from __future__ import annotations

import json

import numpy as np

from .config import ARTIFACTS_DIR, CLASSES, TEST_FOLD
from .data import load_metadata, load_raw_signals
from .recompute_metrics import predict_test
from .train import to_jsonable
from .voltage import lvh_voltage


def rates(flag, y):
    tp, fp, fn = int((flag & y).sum()), int((flag & ~y).sum()), int((~flag & y).sum())
    return {"sensitivity": tp / max(1, tp + fn), "ppv": tp / max(1, tp + fp),
            "tp": tp, "fp": fp, "fn": fn, "flagged": int(flag.sum())}


def main():
    path = ARTIFACTS_DIR / "metrics.json"
    metrics = json.loads(path.read_text())
    th = metrics["thresholds"]["HYP"]

    print("Running the AI on the test fold ...")
    te_meta, Y, P, _ = predict_test()
    meta = load_metadata()
    raw = load_raw_signals(meta)
    keep = meta["superclasses"].apply(len).values > 0
    meta, raw = meta[keep], np.asarray(raw)[keep]
    X = raw[(meta["strat_fold"] == TEST_FOLD).values]

    print("Measuring voltage criteria ...")
    status = []
    for x, sex, age in zip(X, te_meta["sex"].values, te_meta["age"].values):
        v = lvh_voltage(x.astype(np.float32), "F" if sex == 1 else "M", age)
        status.append(v.get("status", "unavailable"))
    status = np.array(status)

    y = Y[:, CLASSES.index("HYP")] == 1
    ai = P[:, CLASSES.index("HYP")] >= th
    met = status == "met"
    near = met | (status == "borderline")
    res = {
        "threshold": th, "n_test": int(len(y)), "n_hyp": int(y.sum()),
        "unavailable": int((status == "unavailable").sum()),
        "ai": rates(ai, y),
        "voltage_met": rates(met, y),
        "ai_or_met": rates(ai | met, y),
        "ai_or_borderline": rates(ai | near, y),
        "ai_misses": int((y & ~ai).sum()),
        "ai_misses_met": int((y & ~ai & met).sum()),
        "ai_misses_borderline": int((y & ~ai & (status == "borderline")).sum()),
        "extra_alarms_met": int((~y & ~ai & met).sum()),
        "extra_alarms_borderline": int((~y & ~ai & (status == "borderline")).sum()),
    }
    metrics["lvh_voltage"] = res
    path.write_text(json.dumps(to_jsonable(metrics)))
    print(json.dumps(to_jsonable(res), indent=1))


if __name__ == "__main__":
    main()
