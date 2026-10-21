"""Start the RADAR web platform (FastAPI on port 8000).

Development:
  Terminal 1:  python run_web.py
  Terminal 2:  cd frontend && npm install && npm run dev
  Open http://localhost:5173

Production (after `cd frontend && npm run build`):
  python run_web.py --static
  Open http://localhost:8000
"""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

DIST = Path(__file__).resolve().parent / "frontend" / "dist"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--static", action="store_true", help="Serve frontend/dist from FastAPI")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.static:
        if not DIST.exists():
            raise SystemExit("frontend/dist is missing. Run: cd frontend && npm run build")
        from fastapi.staticfiles import StaticFiles
        import api as api_module

        api_module.app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
    uvicorn.run("api:app", host="127.0.0.1", port=args.port, reload=not args.static)


if __name__ == "__main__":
    main()
