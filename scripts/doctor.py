from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    print("HELIX V5.3.1 DOCTOR")
    print(f"Python: {sys.version.split()[0]}")
    if sys.version_info < (3, 11):
        print("FAIL: Python 3.11+ is required")
        return 1

    modules = ["fastapi", "uvicorn", "httpx", "pydantic", "pydantic_settings"]
    failed = False
    for name in modules:
        try:
            mod = importlib.import_module(name)
            print(f"OK  import {name} {getattr(mod, '__version__', '')}".rstrip())
        except Exception as exc:
            print(f"FAIL import {name}: {exc}")
            failed = True

    for path in [ROOT / ".env.example", ROOT / "frontend" / "index.html", ROOT / "app" / "main.py"]:
        if path.exists():
            print(f"OK  {path.relative_to(ROOT)}")
        else:
            print(f"FAIL missing {path.relative_to(ROOT)}")
            failed = True

    if not failed:
        print("READY: run `python -m app.main`")
        return 0
    print("NOT READY: install dependencies with `pip install -e \".[dev]\"`")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
