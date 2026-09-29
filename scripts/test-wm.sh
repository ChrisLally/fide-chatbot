#!/usr/bin/env bash
# WM contract checks against the live catalina-world-model (no LLM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export FIDE_DIR="${FIDE_DIR:-/var/lib/fide/hosted-runners/runner_ch4v4nbzkjreevke/.fide}"
exec python3 "$ROOT/_scripts/audit_alison_brief.py" "$@"
