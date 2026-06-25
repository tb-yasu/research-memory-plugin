#!/usr/bin/env bash
# Clean single-stack dev launcher for the paper-memory demo.
#
# Why this exists: running `yarn dev` twice leaves TWO servers fighting
# over port 3001. The auth token (regenerated per startup, mirrored to
# ~/mulmoclaude/.session-token) then mismatches between the Vite-injected
# token and the server actually answering on :3001 -> /api/roles returns
# 401 -> custom roles (e.g. "Research") silently vanish from the dropdown.
#
# This script kills any existing stack FIRST, frees the ports, clears the
# stale token, then starts exactly ONE stack in the foreground (Ctrl-C to
# stop cleanly). Sandbox is disabled so the agent runs on the host and
# sees your workspace papers; the plugin is loaded from this repo.
set -euo pipefail

MULMO_DIR="${MULMO_DIR:-$HOME/Prog/110_agents/mulmoclaude}"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$MULMO_DIR" ]; then
  echo "✗ MULMO_DIR not found: $MULMO_DIR" >&2
  echo "  set it:  MULMO_DIR=/path/to/mulmoclaude ./dev.sh" >&2
  exit 1
fi

echo "→ killing any existing mulmoclaude dev stack…"
pkill -9 -f "concurrently -n server,client" 2>/dev/null || true
pkill -9 -f "tsx server/index.ts" 2>/dev/null || true
pkill -9 -f "node_modules/.bin/vite" 2>/dev/null || true
pkill -9 -f "tsx/dist/preflight.cjs" 2>/dev/null || true
for p in $(lsof -t -iTCP:3001 -sTCP:LISTEN 2>/dev/null) $(lsof -t -iTCP:5173 -sTCP:LISTEN 2>/dev/null); do
  kill -9 "$p" 2>/dev/null || true
done
rm -f "$HOME/mulmoclaude/.session-token"
sleep 1

echo "→ starting ONE stack (sandbox off, dev plugin = $PLUGIN_DIR)…"
echo "  open http://localhost:5173/  and pick the Research role."
cd "$MULMO_DIR"
exec env DISABLE_SANDBOX=1 MULMOCLAUDE_DEV_PLUGINS="$PLUGIN_DIR" \
  RESEARCH_MEMORY_MAILTO="${RESEARCH_MEMORY_MAILTO:-}" yarn dev
