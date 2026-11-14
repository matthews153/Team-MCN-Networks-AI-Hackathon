from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
VITE = FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"
PAGE_URL = "http://127.0.0.1:5173"
API_URL = "http://127.0.0.1:8000/api/health"


def wait_for_server(url: str, process: subprocess.Popen, name: str) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"The {name} stopped before it was ready.")
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    raise RuntimeError(f"The {name} did not start within 90 seconds.")


def main() -> int:
    if not shutil.which("node"):
        print("Node.js is required. Install Node.js, then run this file again.")
        return 1
    if not VITE.is_file():
        print("Frontend dependencies are missing. Run `npm install` in the frontend folder.")
        return 1
    if importlib.util.find_spec("uvicorn") is None:
        print("Python dependencies are missing. Run `python -m pip install -r requirements.txt`.")
        return 1

    processes: list[subprocess.Popen] = []
    try:
        processes.append(
            subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "backend.app:app",
                 "--host", "127.0.0.1", "--port", "8000"],
                cwd=ROOT,
            )
        )
        processes.append(
            subprocess.Popen(
                ["node", str(VITE), "--host", "127.0.0.1", "--strictPort"],
                cwd=FRONTEND,
            )
        )

        wait_for_server(API_URL, processes[0], "CardioLens API")
        wait_for_server(PAGE_URL, processes[1], "CardioLens page")
        print(f"CardioLens is running at {PAGE_URL}")
        webbrowser.open(PAGE_URL)
        print("Press Ctrl+C here to stop CardioLens.")
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        return 1
    except KeyboardInterrupt:
        return 0
    except RuntimeError as error:
        print(error)
        return 1
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
