"""Start CardioLens with one command.

    python3 Main.py            # one server: API + dashboard on http://127.0.0.1:8000
    python3 Main.py --dev      # UI hot reload: API on :8000 + Vite dev server on :5173
    python3 Main.py --rebuild  # force a fresh frontend build first

In the default mode the dashboard is built once into frontend/dist (only when the
frontend source has changed) and served by the same FastAPI/uvicorn process as the API,
so Node.js is only needed when a build is required.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
DIST_INDEX = FRONTEND / "dist" / "index.html"
VITE = FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"
HOST = "127.0.0.1"
# the API version this checkout's backend provides (read from backend/app.py, no heavy imports)
_m = re.search(r"^API_VERSION = (\d+)", (ROOT / "backend" / "app.py").read_text(), re.M)
API_VERSION = int(_m.group(1)) if _m else 0
DEV_PORT = 5173
# Files whose changes mean the dashboard must be rebuilt
FRONTEND_SOURCES = ["src", "index.html", "package.json", "package-lock.json", "vite.config.js"]


# --------------------------------------------------------------------------- #
def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0


def wait_for_server(url: str, process: subprocess.Popen, name: str) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"The {name} stopped before it was ready.")
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(0.5)
    raise RuntimeError(f"The {name} did not start within 90 seconds.")


def newest_source_mtime() -> float:
    newest = 0.0
    for name in FRONTEND_SOURCES:
        p = FRONTEND / name
        files = p.rglob("*") if p.is_dir() else [p]
        for f in files:
            if f.is_file():
                newest = max(newest, f.stat().st_mtime)
    return newest


def build_needed() -> bool:
    return not DIST_INDEX.is_file() or DIST_INDEX.stat().st_mtime < newest_source_mtime()


def ensure_node_modules() -> None:
    if not shutil.which("node") or not shutil.which("npm"):
        raise RuntimeError("Node.js is required to build the dashboard. Install Node.js 18+, "
                           "then run this file again.")
    if not VITE.is_file():
        print("Installing frontend dependencies (first run only)...")
        subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=FRONTEND, check=True)


def build_frontend() -> None:
    ensure_node_modules()
    print("Building the dashboard...")
    subprocess.run(["npm", "run", "build"], cwd=FRONTEND, check=True)


def check_python_deps() -> None:
    missing = [m for m in ("uvicorn", "fastapi", "torch") if importlib.util.find_spec(m) is None]
    if missing:
        raise RuntimeError(f"Python dependencies are missing ({', '.join(missing)}). "
                           "Run `python3 -m pip install -r requirements.txt`.")


def running_cardiolens(port: int):
    """api_version of a CardioLens server already on this port, 0 if it predates versioning, None if not CardioLens."""
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/health", timeout=2) as r:
            return json.loads(r.read()).get("api_version", 0)
    except Exception:  # noqa: BLE001
        return None


def start_api(port: int, reload: bool = False) -> subprocess.Popen:
    if port_in_use(port):
        version = running_cardiolens(port)
        stop_hint = (f"Stop it first: press Ctrl+C in the terminal where it runs, or close that terminal"
                     + ("" if os.name == "nt" else f" (or run: lsof -ti tcp:{port} | xargs kill)") + ".")
        if version is None:
            raise RuntimeError(f"Port {port} is used by another program. Start CardioLens on another port, "
                               f"e.g. python3 Main.py --port {port + 1}.")
        raise RuntimeError(f"CardioLens is already running on port {port}"
                           + (" — an OLDER version, so new features (e.g. doctor sign-in) won't work. "
                              if version < API_VERSION else ". ")
                           + stop_hint + " Then run python3 Main.py again.")
    cmd = [sys.executable, "-m", "uvicorn", "backend.app:app", "--host", HOST, "--port", str(port)]
    if reload:
        cmd += ["--reload", "--reload-dir", "backend", "--reload-dir", "ml"]
    return subprocess.Popen(cmd, cwd=ROOT)


# --------------------------------------------------------------------------- #
def run(args: argparse.Namespace) -> int:
    check_python_deps()
    processes: list[subprocess.Popen] = []
    try:
        if args.dev:
            ensure_node_modules()
            if port_in_use(DEV_PORT):
                raise RuntimeError(f"Port {DEV_PORT} is already in use.")
            processes.append(start_api(args.port, reload=True))
            processes.append(subprocess.Popen(
                ["node", str(VITE), "--host", HOST, "--port", str(DEV_PORT), "--strictPort"],
                cwd=FRONTEND, env={**os.environ, "CARDIOLENS_API_PORT": str(args.port)}))
            page_url = f"http://{HOST}:{DEV_PORT}"
            wait_for_server(f"http://{HOST}:{args.port}/api/health", processes[0], "CardioLens API")
            wait_for_server(page_url, processes[1], "Vite dev server")
        else:
            if args.rebuild or build_needed():
                build_frontend()
            processes.append(start_api(args.port))
            page_url = f"http://{HOST}:{args.port}"
            wait_for_server(f"{page_url}/api/health", processes[0], "CardioLens server")

        print(f"\nCardioLens is running at {page_url}" + ("  (dev mode, hot reload)" if args.dev else ""))
        if not args.no_browser:
            webbrowser.open(page_url)
        print("Press Ctrl+C here to stop CardioLens.")
        while all(p.poll() is None for p in processes):
            time.sleep(1)
        return 1
    except KeyboardInterrupt:
        return 0
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(error)
        return 1
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
        for p in processes:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description="Start CardioLens (API + dashboard).")
    parser.add_argument("--dev", action="store_true",
                        help="UI development mode: Vite hot reload on :5173 + API auto-reload")
    parser.add_argument("--port", type=int, default=8000, help="API/dashboard port (default 8000)")
    parser.add_argument("--rebuild", action="store_true", help="force a fresh frontend build")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
