"""Parse uploaded ECG files into (signal[T,12] in mV, fs) records.

Supported:
  * WFDB pair: .hea + .dat (PTB-XL native format, any sampling rate)
  * .csv / .txt: 12 columns (optional header with lead names); optional `fs=` in filename
  * .npy: (T,12) or (12,T) array, assumed 100 Hz if 1000 samples, 500 Hz if 5000
  * .json: {"fs": 500, "signal": [[...12 values...], ...]} or {"leads": {"I": [...], ...}}
  * .zip containing any of the above
"""
from __future__ import annotations

import io
import json
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

import numpy as np

from ml.config import LEADS

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".pdf", ".heic", ".webp"}
_ALIASES = {l.lower(): i for i, l in enumerate(LEADS)}
_ALIASES.update({"avr": 3, "avl": 4, "avf": 5, "lead_i": 0, "lead_ii": 1, "lead_iii": 2})


class ParseError(ValueError):
    pass


_AGE_RE = re.compile(r"\bage\b[^0-9a-z]{0,4}(\d{1,3}(?:\.\d+)?)", re.I)
_SEX_RE = re.compile(r"\b(?:sex|gender)\b[^a-z]{0,4}(male|female|man|woman|m|f)\b", re.I)


def _norm_sex(v) -> Optional[str]:
    v = str(v or "").strip().lower()
    if v in ("m", "male", "man", "0"):
        return "M"
    if v in ("f", "female", "woman", "1"):
        return "F"
    return None


def _demographics(name: str, data: bytes) -> dict:
    """Age/sex carried inside the file, if any: WFDB header comments
    (e.g. '# Age: 63' / '# Sex: Male', as in PhysioNet Challenge records) or JSON fields."""
    out: dict = {}
    ext = Path(name).suffix.lower()
    try:
        if ext == ".hea":
            text = "\n".join(l.lstrip("#") for l in data.decode("utf-8", "ignore").splitlines()
                             if l.lstrip().startswith("#"))
            if (m := _AGE_RE.search(text)):
                out["age"] = float(m.group(1))
            if (m := _SEX_RE.search(text)) and _norm_sex(m.group(1)):
                out["sex"] = _norm_sex(m.group(1))
        elif ext == ".json":
            obj = json.loads(data)
            src = obj.get("patient", obj) if isinstance(obj, dict) else {}
            if isinstance(src.get("age"), (int, float)) or str(src.get("age", "")).replace(".", "", 1).isdigit():
                out["age"] = float(src["age"])
            if _norm_sex(src.get("sex") or src.get("gender")):
                out["sex"] = _norm_sex(src.get("sex") or src.get("gender"))
    except Exception:  # noqa: BLE001 — demographics are optional
        return {}
    if "age" in out and not 0 < out["age"] < 120:
        out.pop("age")
    return out


def _guess_fs(n: int, name: str) -> float:
    m = re.search(r"fs[=_-]?(\d+)", name.lower())
    if m:
        return float(m.group(1))
    if n >= 4000:
        return n / 10.0  # assume a standard 10 s recording
    if n >= 900:
        return n / 10.0
    return 100.0


def _orient(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim != 2:
        raise ParseError(f"Expected a 2-D array, got shape {arr.shape}")
    if arr.shape[1] != 12 and arr.shape[0] == 12:
        arr = arr.T
    if arr.shape[1] != 12:
        raise ParseError(f"Expected 12 leads, got shape {arr.shape}")
    # Heuristic unit fix: values in µV instead of mV
    if np.nanmax(np.abs(arr)) > 50:
        arr = arr / 1000.0
    return arr


def _parse_csv(data: bytes, name: str):
    text = data.decode("utf-8", errors="ignore").strip().splitlines()
    first = [t.strip().strip('"') for t in re.split(r"[,;\t]", text[0])]
    order = None
    body = text
    if any(re.search(r"[a-zA-Z]", t) for t in first):
        body = text[1:]
        idx = [_ALIASES.get(t.lower()) for t in first]
        if sum(i is not None for i in idx) >= 12:
            order = idx
    rows = [[float(v) for v in re.split(r"[,;\t]", r) if v.strip() != ""] for r in body if r.strip()]
    arr = np.array(rows, dtype=np.float32)
    if order is not None:
        out = np.zeros((arr.shape[0], 12), dtype=np.float32)
        for col, li in enumerate(order):
            if li is not None and col < arr.shape[1]:
                out[:, li] = arr[:, col]
        arr = out
    elif arr.shape[1] == 13:  # leading time / index column
        arr = arr[:, 1:]
    arr = _orient(arr)
    return arr, _guess_fs(arr.shape[0], name)


def _parse_json(data: bytes, name: str):
    obj = json.loads(data)
    if "leads" in obj:
        arr = np.stack([np.asarray(obj["leads"][l], dtype=np.float32) for l in LEADS], axis=1)
    else:
        arr = np.asarray(obj["signal"], dtype=np.float32)
    arr = _orient(arr)
    return arr, float(obj.get("fs") or _guess_fs(arr.shape[0], name))


def _parse_npy(data: bytes, name: str):
    arr = _orient(np.load(io.BytesIO(data), allow_pickle=False))
    return arr, _guess_fs(arr.shape[0], name)


def _parse_wfdb(hea: bytes, dat: bytes, stem: str):
    import wfdb

    with tempfile.TemporaryDirectory() as td:
        hea_text = hea.decode("utf-8", errors="ignore")
        # the header references the data file by name; normalise it to <stem>.dat
        dat_name = hea_text.splitlines()[1].split()[0] if len(hea_text.splitlines()) > 1 else stem + ".dat"
        Path(td, stem + ".hea").write_bytes(hea)
        Path(td, dat_name).write_bytes(dat)
        try:
            sig, fields = wfdb.rdsamp(str(Path(td, stem)))
        except Exception as e:  # noqa: BLE001
            raise ParseError(f"Could not read WFDB record '{stem}': {e}") from e
    names = [n.lower() for n in fields["sig_name"]]
    out = np.zeros((sig.shape[0], 12), dtype=np.float32)
    for col, n in enumerate(names):
        li = _ALIASES.get(n)
        if li is not None:
            out[:, li] = sig[:, col]
    if len(names) != 12 or any(_ALIASES.get(n) is None for n in names):
        out = _orient(sig)
    return out, float(fields["fs"])


def parse_files(files: list[tuple[str, bytes]]) -> list[dict]:
    """files: list of (filename, bytes) -> list of {name, signal, fs} or {name, error}."""
    expanded: list[tuple[str, bytes]] = []
    for name, data in files:
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for zi in z.infolist():
                    if not zi.is_dir() and not Path(zi.filename).name.startswith("."):
                        expanded.append((Path(zi.filename).name, z.read(zi)))
        else:
            expanded.append((name, data))

    by_stem: dict[str, dict[str, bytes]] = {}
    results = []
    for name, data in expanded:
        p = Path(name)
        ext = p.suffix.lower()
        if ext in (".hea", ".dat"):
            by_stem.setdefault(p.stem, {})[ext] = data
            continue
        try:
            if ext in IMAGE_EXT:
                raise ParseError("ECG image/PDF digitisation is not supported yet — please upload "
                                 "the digital export (WFDB .hea/.dat, CSV, JSON or NPY).")
            if ext in (".csv", ".txt"):
                sig, fs = _parse_csv(data, name)
            elif ext == ".json":
                sig, fs = _parse_json(data, name)
            elif ext == ".npy":
                sig, fs = _parse_npy(data, name)
            else:
                raise ParseError(f"Unsupported file type '{ext}'")
            results.append({"name": name, "signal": sig, "fs": fs,
                            "demographics": _demographics(name, data)})
        except ParseError as e:
            results.append({"name": name, "error": str(e)})
        except Exception as e:  # noqa: BLE001
            results.append({"name": name, "error": f"Could not parse file: {e}"})

    for stem, parts in by_stem.items():
        if ".hea" not in parts or ".dat" not in parts:
            missing = ".dat" if ".hea" in parts else ".hea"
            results.append({"name": stem, "error": f"WFDB record is missing its {missing} file"})
            continue
        try:
            sig, fs = _parse_wfdb(parts[".hea"], parts[".dat"], stem)
            results.append({"name": stem + " (WFDB)", "signal": sig, "fs": fs,
                            "demographics": _demographics(stem + ".hea", parts[".hea"])})
        except ParseError as e:
            results.append({"name": stem, "error": str(e)})
    return results
