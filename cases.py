"""Save and bring back CardioLens case lists (snapshots).

    python3 cases.py list                         # show saved snapshots
    python3 cases.py save my_demo_set             # save the current dashboard cases
    python3 cases.py restore cases_2026-11-14     # bring a snapshot's cases back (merge)
    python3 cases.py restore NAME --demo-only     # only its demo cases
    python3 cases.py restore NAME --replace       # replace the current cases entirely

Snapshots live in data/snapshots/<name>.json (local only, not committed to git).
Works whether or not CardioLens is running: if the server is up the change goes through
it and the dashboard updates immediately; otherwise data/cases.json is edited directly.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES_FILE = ROOT / "data" / "cases.json"
SNAPSHOT_DIR = ROOT / "data" / "snapshots"


# --------------------------------------------------------------------------- #
def api(port: int, method: str, path: str, **params):
    """Call the running server; returns None if it isn't running."""
    q = {k: str(v).lower() for k, v in params.items() if v}
    url = f"http://127.0.0.1:{port}{path}" + (f"?{urllib.parse.urlencode(q)}" if q else "")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = json.loads(e.read() or b"{}").get("detail", e.reason)
        sys.exit(f"Error: {detail}")
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        return None


def is_demo(c: dict) -> bool:
    return bool(c.get("demo")) or str(c.get("source", "")).startswith("PTB-XL test record")


def snapshot_path(name: str) -> Path:
    name = name.removesuffix(".json")
    if not name or name.startswith(".") or not all(ch.isalnum() or ch in "-_." for ch in name):
        sys.exit("Error: snapshot names may only contain letters, digits, '-', '_' and '.'")
    return SNAPSHOT_DIR / f"{name}.json"


def read_cases(path: Path) -> list[dict]:
    return json.loads(path.read_text()) if path.exists() else []


# --------------------------------------------------------------------------- #
def cmd_list(args) -> None:
    files = sorted(SNAPSHOT_DIR.glob("*.json"))
    if not files:
        print("No snapshots yet. Save one with: python3 cases.py save <name>")
        return
    print(f"{'snapshot':32} {'cases':>5} {'demo':>5} {'real':>5}  saved")
    for f in files:
        cases = read_cases(f)
        demo = sum(is_demo(c) for c in cases)
        saved = time.strftime("%Y-%m-%d %H:%M", time.localtime(f.stat().st_mtime))
        print(f"{f.stem:32} {len(cases):5} {demo:5} {len(cases) - demo:5}  {saved}")
    current = read_cases(CASES_FILE)
    print(f"\nDashboard now: {len(current)} cases ({sum(is_demo(c) for c in current)} demo)")


def cmd_save(args) -> None:
    path = snapshot_path(args.name)
    res = api(args.port, "POST", f"/api/snapshots/{path.stem}", overwrite=args.overwrite)
    if res is None:  # server not running: copy the saved case file
        if path.exists() and not args.overwrite:
            sys.exit(f"Error: snapshot '{path.stem}' already exists (add --overwrite)")
        cases = read_cases(CASES_FILE)
        SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cases))
        res = {"cases": len(cases)}
    print(f"Saved {res['cases']} cases to {path.relative_to(ROOT)}")


def cmd_restore(args) -> None:
    path = snapshot_path(args.name)
    if not path.exists():
        sys.exit(f"Error: snapshot '{path.stem}' not found. See: python3 cases.py list")
    res = api(args.port, "POST", f"/api/snapshots/{path.stem}/restore",
              replace=args.replace, demo_only=args.demo_only)
    via = "running server"
    if res is None:  # server not running: merge into data/cases.json directly
        via = "data/cases.json"
        snap = [c for c in read_cases(path) if not args.demo_only or is_demo(c)]
        current = {} if args.replace else {c["id"]: c for c in read_cases(CASES_FILE)}
        added = 0
        for c in snap:
            if c["id"] not in current:
                current[c["id"]] = c
                added += 1
        CASES_FILE.parent.mkdir(parents=True, exist_ok=True)
        CASES_FILE.write_text(json.dumps(list(current.values())))
        res = {"added": added, "skipped": len(snap) - added, "total": len(current)}
    print(f"Restored from '{path.stem}' via {via}: {res['added']} added, "
          f"{res['skipped']} already present, {res['total']} cases on the dashboard.")


def main() -> None:
    p = argparse.ArgumentParser(description="Save and restore CardioLens case snapshots.")
    p.add_argument("--port", type=int, default=8000, help="CardioLens server port (default 8000)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="show saved snapshots").set_defaults(fn=cmd_list)
    s = sub.add_parser("save", help="save the current cases as a snapshot")
    s.add_argument("name")
    s.add_argument("--overwrite", action="store_true")
    s.set_defaults(fn=cmd_save)
    r = sub.add_parser("restore", help="bring a snapshot's cases back into the dashboard")
    r.add_argument("name")
    r.add_argument("--replace", action="store_true", help="replace current cases instead of merging")
    r.add_argument("--demo-only", action="store_true", help="only restore the demo cases")
    r.set_defaults(fn=cmd_restore)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
