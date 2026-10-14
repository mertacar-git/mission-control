#!/usr/bin/env bash
set -euo pipefail
project=$(cd "$(dirname "$0")/.." && pwd)
runtime=${MISSION_RUNTIME:-/opt/mission-control}
"$runtime/venv/bin/pip" install -r "$project/backend/requirements.txt"
cd "$project/backend"
exec "$runtime/venv/bin/python" -m uvicorn mission_control.api:app --host 127.0.0.1 --port 8000
