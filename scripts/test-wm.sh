#!/usr/bin/env bash
# Live world-model checks against catalina-world-model (no LLM calls).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export FIDE_DIR="${FIDE_DIR:-/var/lib/fide/hosted-runners/runner_6a2kmd5egybdbqjx/.fide}"
exec python3 "$ROOT/_scripts/wm_checks/check_world_model.py"
