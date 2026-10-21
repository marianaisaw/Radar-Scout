#!/bin/zsh
set -e
cd "$(dirname "$0")"
python -m pip install -q fastapi uvicorn
( cd frontend && npm install )
trap 'kill 0' EXIT
python -m uvicorn api:app --reload --port 8000 &
( cd frontend && npm run dev )
