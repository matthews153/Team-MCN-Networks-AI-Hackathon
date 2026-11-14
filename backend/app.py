"""CardioLens FastAPI backend.

Run:  .venv/bin/uvicorn backend.app:app --reload --port 8000
"""
from __future__ import annotations

import json
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ml.config import ARTIFACTS_DIR, CLASS_INFO, CLASSES, DATA_DIR, ROOT

from .inference import Engine
from .parsers import parse_files

app = FastAPI(title="CardioLens API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

engine = Engine()
CASES_FILE = DATA_DIR / "cases.json"
_lock = threading.Lock()
CASES: dict[str, dict] = {}
if CASES_FILE.exists():
    try:
        CASES = {c["id"]: c for c in json.loads(CASES_FILE.read_text())}
    except Exception:  # noqa: BLE001
        CASES = {}


def _save():
    DATA_DIR.mkdir(exist_ok=True)
    CASES_FILE.write_text(json.dumps(list(CASES.values())))


def _summary(c: dict) -> dict:
    r = c["result"]
    return {
        "id": c["id"], "created_at": c["created_at"], "source": c["source"],
        "patient": c["patient"], "review": c["review"], "demo": c.get("demo", False),
        "category": r["category"], "headline": r["headline"], "flagged": r["flagged"],
        "triage": {k: r["triage"][k] for k in ("level", "label", "score")},
        "quality": {"score": r["quality"]["score"], "grade": r["quality"]["grade"]},
        "heart_rate": r["rhythm"].get("heart_rate"),
        "probs": {f["code"]: f["probability"] for f in r["findings"]},
        "uncertain": r["uncertain"], "ground_truth": c.get("ground_truth"),
    }


def _new_case(result: dict, patient: dict, source: str, ground_truth=None, demo=False,
              created_at: Optional[float] = None) -> dict:
    cid = uuid.uuid4().hex[:10]
    case = {
        "id": cid, "created_at": created_at or time.time(), "source": source,
        "patient": patient, "result": result, "ground_truth": ground_truth, "demo": demo,
        "review": {"status": "pending", "doctor_labels": None, "agrees": None,
                   "notes": "", "reviewed_at": None},
    }
    with _lock:
        CASES[cid] = case
        _save()
    return case


def _require_model():
    if not engine.ready:
        engine.load()
    if not engine.ready:
        raise HTTPException(503, "Model not trained yet. Run `python -m ml.train`.")


def _load_samples():
    idx_path = ARTIFACTS_DIR / "samples.json"
    if not idx_path.exists():
        return [], None
    index = json.loads(idx_path.read_text())
    sigs = np.load(ARTIFACTS_DIR / "samples.npz")["signals"]
    return index, sigs


# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    return {"ok": True, "model_ready": engine.ready, "ensemble_size": len(engine.models),
            "classes": CLASSES, "class_info": CLASS_INFO}


@app.post("/api/reload")
def reload_model():
    engine.load()
    return health()


@app.get("/api/model")
def model_metrics():
    _require_model()
    return engine.metrics


@app.get("/api/samples")
def samples():
    index, _ = _load_samples()
    return index


def _patient(patient_json: Optional[str]) -> dict:
    if not patient_json:
        return {}
    try:
        return json.loads(patient_json)
    except json.JSONDecodeError:
        raise HTTPException(400, "patient must be JSON")


@app.post("/api/samples/{idx}/analyze")
def analyze_sample(idx: int, patient: Optional[str] = Form(None)):
    _require_model()
    index, sigs = _load_samples()
    if idx < 0 or idx >= len(index):
        raise HTTPException(404, "sample not found")
    meta = index[idx]
    p = _patient(patient)
    p.setdefault("age", meta["age"])
    p.setdefault("sex", meta["sex"])
    p.setdefault("patient_id", f"PTBXL-{meta['ecg_id']}")
    result = engine.analyze(sigs[idx], 100, p)
    case = _new_case(result, p, f"PTB-XL test record {meta['ecg_id']}",
                     ground_truth=meta["true_labels"])
    return case


@app.post("/api/analyze")
async def analyze_upload(files: list[UploadFile] = File(...), patient: Optional[str] = Form(None)):
    _require_model()
    p = _patient(patient)
    raw = [(f.filename or "upload", await f.read()) for f in files]
    parsed = parse_files(raw)
    out = []
    for item in parsed:
        if "error" in item:
            out.append({"name": item["name"], "error": item["error"]})
            continue
        try:
            result = engine.analyze(item["signal"], item["fs"], p)
        except Exception as e:  # noqa: BLE001
            out.append({"name": item["name"], "error": f"Analysis failed: {e}"})
            continue
        pp = dict(p)
        if len(parsed) > 1 and pp.get("patient_id"):
            pp["patient_id"] = f"{pp['patient_id']}-{len(out)+1}"
        case = _new_case(result, pp, item["name"])
        out.append({"name": item["name"], "case_id": case["id"], "summary": _summary(case)})
    return out


@app.get("/api/cases")
def list_cases():
    return sorted((_summary(c) for c in CASES.values()), key=lambda s: -s["created_at"])


@app.get("/api/cases/{cid}")
def get_case(cid: str):
    if cid not in CASES:
        raise HTTPException(404, "case not found")
    return CASES[cid]


class Review(BaseModel):
    status: str = "reviewed"
    doctor_labels: Optional[list[str]] = None
    agrees: Optional[bool] = None
    notes: str = ""


@app.patch("/api/cases/{cid}/review")
def review_case(cid: str, review: Review):
    if cid not in CASES:
        raise HTTPException(404, "case not found")
    with _lock:
        CASES[cid]["review"] = {**review.model_dump(), "reviewed_at": time.time()}
        _save()
    return CASES[cid]


@app.delete("/api/cases/{cid}")
def delete_case(cid: str):
    with _lock:
        CASES.pop(cid, None)
        _save()
    return {"ok": True}


@app.delete("/api/cases")
def clear_cases():
    with _lock:
        CASES.clear()
        _save()
    return {"ok": True}


SYMPTOM_POOL = ["chest pain", "shortness of breath", "palpitations", "dizziness", "syncope", "fatigue"]


@app.post("/api/demo/seed")
def seed_demo(n: int = 24):
    """Populate the queue with synthetic patients using unseen PTB-XL test ECGs."""
    _require_model()
    index, sigs = _load_samples()
    rng = random.Random(7)
    picks = rng.sample(range(len(index)), min(n, len(index)))
    now = time.time()
    for k, i in enumerate(picks):
        meta = index[i]
        sym = rng.sample(SYMPTOM_POOL, rng.choice([0, 0, 1, 1, 2]))
        p = {"patient_id": f"PT-{1000 + rng.randint(0, 8999)}", "age": meta["age"], "sex": meta["sex"],
             "symptoms": sym, "facility": rng.choice(["District Clinic A", "Rural Health Post B",
                                                      "Community Centre C", "Outpatient Dept"])}
        result = engine.analyze(sigs[i], 100, p)
        case = _new_case(result, p, f"PTB-XL test record {meta['ecg_id']}",
                         ground_truth=meta["true_labels"], demo=True,
                         created_at=now - rng.uniform(0, 6.5 * 86400))
        if rng.random() < 0.4:
            # Simulated review: the PTB-XL cardiologist label stands in for the doctor's read
            # agreement = the clinician confirms the AI's primary finding
            primary = result["flagged"][0] if result["flagged"] else (
                "NORM" if result["category"] == "normal" else None)
            agrees = primary in meta["true_labels"]
            case["review"] = {"status": "reviewed",
                              "doctor_labels": meta["true_labels"], "agrees": agrees,
                              "notes": "", "reviewed_at": case["created_at"] + rng.uniform(600, 20000)}
    with _lock:
        _save()
    return {"ok": True, "count": len(picks)}


# --------------------------------------------------------------------------- #
# Serve built frontend (frontend/dist) if present
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
