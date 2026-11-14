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
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
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


def _tag_demo(c: dict) -> dict:
    # Older saves did not tag demo-library analyses; PTB-XL test records are always demo data
    if str(c.get("source", "")).startswith("PTB-XL test record"):
        c["demo"] = True
    return c


for _c in CASES.values():
    _tag_demo(_c)


def _backfill_voltage() -> int:
    """Cases analysed before the LVH voltage check existed get it computed from their stored signal."""
    from .inference import _num, add_voltage_note
    from ml.voltage import lvh_voltage
    n = 0
    for c in CASES.values():
        r = c.get("result") or {}
        v = r.get("lvh_voltage")
        lv = getattr(engine, "metrics", {}).get("lvh_voltage") if engine.ready else None
        if v and lv and "test_hit_rate" not in v and v.get("status") in ("met", "borderline") \
                and "HYP" not in r.get("flagged", []):
            hits, alarms = lv[f"ai_misses_{v['status']}"], lv[f"extra_alarms_{v['status']}"]
            v["test_hit_rate"] = {"hits": hits, "total": hits + alarms}
            n += 1
        if v or not r.get("signal"):
            continue
        try:
            x = np.asarray(r["signal"], dtype=np.float32).T            # (1000, 12) mV
            p = c.get("patient") or {}
            r["lvh_voltage"] = lvh_voltage(x, p.get("sex"), _num(p.get("age")), r.get("rhythm", {}).get("r_peaks"))
            v, lv = r["lvh_voltage"], (engine.metrics.get("lvh_voltage") if engine.ready else None)
            if lv and v.get("status") in ("met", "borderline") and "HYP" not in r.get("flagged", []):
                hits, alarms = lv[f"ai_misses_{v['status']}"], lv[f"extra_alarms_{v['status']}"]
                v["test_hit_rate"] = {"hits": hits, "total": hits + alarms}
            add_voltage_note(r["triage"], r["lvh_voltage"], r.get("flagged", []))
            n += 1
        except Exception:  # noqa: BLE001 — never block startup on an old case
            continue
    return n


SNAPSHOT_DIR = DATA_DIR / "snapshots"
DOCTORS_FILE = DATA_DIR / "doctors.json"


# --------------------------------------------------------------------------- #
# Doctors: name-only sign-in (no passwords) — the queue is shared, uploads and
# reviews are signed with the doctor's name. The browser sends it as X-Doctor.
def _load_doctors() -> list[str]:
    try:
        return json.loads(DOCTORS_FILE.read_text()) if DOCTORS_FILE.exists() else []
    except Exception:  # noqa: BLE001
        return []


def _doctor(request: Request) -> Optional[str]:
    from urllib.parse import unquote
    name = unquote(request.headers.get("x-doctor", "")).strip()
    return name[:60] or None


def _save():
    DATA_DIR.mkdir(exist_ok=True)
    CASES_FILE.write_text(json.dumps(list(CASES.values())))


if _backfill_voltage():
    _save()


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
        "uploaded_by": c.get("uploaded_by"),
        "lvh_voltage": (r.get("lvh_voltage") or {}).get("status"),
    }


def _new_case(result: dict, patient: dict, source: str, ground_truth=None, demo=False,
              created_at: Optional[float] = None, uploaded_by: Optional[str] = None) -> dict:
    cid = uuid.uuid4().hex[:10]
    case = {
        "id": cid, "created_at": created_at or time.time(), "source": source,
        "patient": patient, "result": result, "ground_truth": ground_truth, "demo": demo,
        "uploaded_by": uploaded_by,
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
# Bump when the API gains or changes endpoints; the dashboard checks it (frontend/src/lib.js)
# so an old server process left running after a `git pull` is reported clearly.
API_VERSION = 4


@app.get("/api/health")
def health():
    return {"ok": True, "api_version": API_VERSION, "model_ready": engine.ready,
            "ensemble_size": len(engine.models), "classes": CLASSES, "class_info": CLASS_INFO}


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
def analyze_sample(idx: int, request: Request, patient: Optional[str] = Form(None)):
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
                     ground_truth=meta["true_labels"], demo=True, uploaded_by=_doctor(request))
    return case


@app.post("/api/analyze")
async def analyze_upload(request: Request, files: list[UploadFile] = File(...),
                         patient: Optional[str] = Form(None)):
    _require_model()
    p = _patient(patient)
    raw = [(f.filename or "upload", await f.read()) for f in files]
    parsed = parse_files(raw)
    out = []
    for item in parsed:
        if "error" in item:
            out.append({"name": item["name"], "error": item["error"]})
            continue
        pp = dict(p)
        # age/sex stored inside the file fill in whatever the form left empty
        filled = [k for k, v in (item.get("demographics") or {}).items() if pp.get(k) in (None, "")]
        for k in filled:
            pp[k] = item["demographics"][k]
        if filled:
            pp["from_file"] = filled
        try:
            result = engine.analyze(item["signal"], item["fs"], pp)
        except Exception as e:  # noqa: BLE001
            out.append({"name": item["name"], "error": f"Analysis failed: {e}"})
            continue
        if len(parsed) > 1 and pp.get("patient_id"):
            pp["patient_id"] = f"{pp['patient_id']}-{len(out)+1}"
        case = _new_case(result, pp, item["name"], uploaded_by=_doctor(request))
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
def review_case(cid: str, review: Review, request: Request):
    if cid not in CASES:
        raise HTTPException(404, "case not found")
    with _lock:
        CASES[cid]["review"] = {**review.model_dump(), "reviewed_at": time.time(),
                                "reviewed_by": _doctor(request)}
        _save()
    return CASES[cid]


@app.delete("/api/cases/{cid}")
def delete_case(cid: str):
    with _lock:
        CASES.pop(cid, None)
        _save()
    return {"ok": True}


@app.delete("/api/cases")
def clear_cases(demo_only: bool = False):
    """Delete all cases, or with ?demo_only=true only the demo/synthetic ones."""
    with _lock:
        ids = [k for k, c in CASES.items() if c.get("demo")] if demo_only else list(CASES)
        for k in ids:
            CASES.pop(k, None)
        _save()
    return {"ok": True, "deleted": len(ids)}


@app.get("/api/doctors")
def list_doctors():
    names = _load_doctors()
    up, rv = {}, {}
    for c in CASES.values():
        if c.get("uploaded_by"):
            up[c["uploaded_by"]] = up.get(c["uploaded_by"], 0) + 1
        if (c.get("review") or {}).get("reviewed_by"):
            rv[c["review"]["reviewed_by"]] = rv.get(c["review"]["reviewed_by"], 0) + 1
    return [{"name": n, "uploads": up.get(n, 0), "reviews": rv.get(n, 0)} for n in names]


class DoctorIn(BaseModel):
    name: str


@app.post("/api/doctors")
def add_doctor(d: DoctorIn):
    name = " ".join(d.name.split())[:60]
    if not name:
        raise HTTPException(400, "Enter a name")
    with _lock:
        names = _load_doctors()
        existing = next((n for n in names if n.lower() == name.lower()), None)
        if existing:
            return {"name": existing, "created": False}
        names.append(name)
        _save_doctors(names)
    return {"name": name, "created": True}


def _save_doctors(names: list[str]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    DOCTORS_FILE.write_text(json.dumps(names))


def _find_doctor(names: list[str], name: str) -> int:
    i = next((k for k, n in enumerate(names) if n.lower() == " ".join(name.split()).lower()), None)
    if i is None:
        raise HTTPException(404, f"No doctor named '{name}'")
    return i


class DoctorRename(BaseModel):
    name: str
    new_name: str


@app.patch("/api/doctors")
def rename_doctor(d: DoctorRename):
    """Rename a doctor. Their name is updated on every case they uploaded or reviewed."""
    new = " ".join(d.new_name.split())[:60]
    if not new:
        raise HTTPException(400, "Enter a name")
    with _lock:
        names = _load_doctors()
        i = _find_doctor(names, d.name)
        old = names[i]
        if any(n.lower() == new.lower() for k, n in enumerate(names) if k != i):
            raise HTTPException(409, f"'{new}' is already taken")
        names[i] = new
        _save_doctors(names)
        changed = 0
        for c in CASES.values():
            if c.get("uploaded_by") == old:
                c["uploaded_by"] = new
                changed += 1
            if (c.get("review") or {}).get("reviewed_by") == old:
                c["review"]["reviewed_by"] = new
                changed += 1
        if changed:
            _save()
    return {"name": new, "old_name": old, "cases_updated": changed}


@app.delete("/api/doctors")
def delete_doctor(name: str):
    """Remove a doctor from the sign-in list. Past cases keep their name as the record
    of who uploaded or reviewed them."""
    with _lock:
        names = _load_doctors()
        removed = names.pop(_find_doctor(names, name))
        _save_doctors(names)
    return {"ok": True, "name": removed}


@app.get("/api/facilities")
def list_facilities():
    """Referring facilities used in past cases, most used first (for suggestions)."""
    count: dict[str, list] = {}
    for c in CASES.values():
        f = " ".join(str((c.get("patient") or {}).get("facility") or "").split())
        if f:
            k = f.lower()
            n, last, label = count.get(k, [0, 0, f])
            count[k] = [n + 1, max(last, c["created_at"]), label if last > c["created_at"] else f]
    return [v[2] for v in sorted(count.values(), key=lambda v: (-v[0], -v[1]))]


@app.get("/api/patients/{pid}")
def lookup_patient(pid: str):
    """Most recent details recorded for a patient ID, to pre-fill the form."""
    pid = pid.strip().lower()
    matches = sorted((c for c in CASES.values()
                      if str((c.get("patient") or {}).get("patient_id") or "").strip().lower() == pid and pid),
                     key=lambda c: -c["created_at"])
    if not matches:
        raise HTTPException(404, "No previous case for this patient ID")
    info = {"patient_id": matches[0]["patient"].get("patient_id"), "case_count": len(matches),
            "last_seen": matches[0]["created_at"]}
    for k in ("age", "sex", "facility"):   # newest non-empty value of each field
        info[k] = next((c["patient"].get(k) for c in matches if c["patient"].get(k) not in (None, "")), None)
    return info


# --------------------------------------------------------------------------- #
# Snapshots: named copies of the case list in data/snapshots/<name>.json
def _snapshot_path(name: str) -> Path:
    name = name.removesuffix(".json")
    if not name or not all(ch.isalnum() or ch in "-_." for ch in name) or name.startswith("."):
        raise HTTPException(400, "Snapshot names may only contain letters, digits, '-', '_' and '.'")
    return SNAPSHOT_DIR / f"{name}.json"


@app.get("/api/snapshots")
def list_snapshots():
    out = []
    for f in sorted(SNAPSHOT_DIR.glob("*.json")):
        try:
            cases = json.loads(f.read_text())
        except Exception:  # noqa: BLE001
            continue
        demo = sum(bool(_tag_demo(c).get("demo")) for c in cases)
        out.append({"name": f.stem, "cases": len(cases), "demo": demo, "real": len(cases) - demo,
                    "saved_at": f.stat().st_mtime})
    return out


@app.post("/api/snapshots/{name}")
def save_snapshot(name: str, overwrite: bool = False):
    """Save the current case list as a named snapshot."""
    path = _snapshot_path(name)
    if path.exists() and not overwrite:
        raise HTTPException(409, f"Snapshot '{path.stem}' already exists (add --overwrite to replace it)")
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        path.write_text(json.dumps(list(CASES.values())))
        n = len(CASES)
    return {"ok": True, "name": path.stem, "cases": n}


@app.post("/api/snapshots/{name}/restore")
def restore_snapshot(name: str, replace: bool = False, demo_only: bool = False):
    """Bring a snapshot's cases back into the dashboard.

    Default merges: cases already present (same id) are kept as they are and only missing
    ones are added. replace=true swaps the whole case list for the snapshot.
    demo_only=true brings back only the demo cases from the snapshot.
    """
    path = _snapshot_path(name)
    if not path.exists():
        raise HTTPException(404, f"Snapshot '{path.stem}' not found")
    snap = [_tag_demo(c) for c in json.loads(path.read_text())]
    if demo_only:
        snap = [c for c in snap if c.get("demo")]
    with _lock:
        if replace:
            CASES.clear()
        added = 0
        for c in snap:
            if c["id"] not in CASES:
                CASES[c["id"]] = c
                added += 1
        _save()
        total = len(CASES)
    return {"ok": True, "added": added, "skipped": len(snap) - added, "total": total}


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


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def unknown_api(path: str):
    raise HTTPException(404, f"Unknown API endpoint /api/{path}. If you just updated CardioLens, "
                             "restart the server (Ctrl+C, then python3 Main.py).")


# --------------------------------------------------------------------------- #
# Serve built frontend (frontend/dist) if present
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file() and f.resolve().is_relative_to(DIST.resolve()):
            return FileResponse(f)
        # never cache the page shell, so a rebuilt dashboard shows up on the next load
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
