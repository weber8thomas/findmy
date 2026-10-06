#!/usr/bin/env bash
# Starts a fresh backend serving the built frontend, for Playwright.
set -euo pipefail
cd "$(dirname "$0")/../backend"
DATA="$(pwd)/../.e2e-data"
rm -rf "$DATA"
mkdir -p "$DATA"
export DATA_DIR="$DATA"
export STATIC_DIR="$(pwd)/../frontend/dist"
export RATE_LIMIT_ENABLED=false
export ZONE_CONFIRM_FIXES=1
export HOUSEKEEPING_INTERVAL_S=5
exec uv run --frozen uvicorn --factory app.main:create_app --host 127.0.0.1 --port "${E2E_PORT:-8766}"
