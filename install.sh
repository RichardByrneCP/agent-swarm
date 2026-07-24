#!/usr/bin/env bash
# Install agent-swarm as a global command and install its personal skill.
# Safe to re-run. Works on macOS / Linux.
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$TOOL_DIR/skill/SKILL.md"
SKILL_DEST_DIR="$HOME/.cursor/skills/agent-swarm"

echo "agent-swarm installer"
echo "  tool dir: $TOOL_DIR"

# 1. Node version check (@cursor/sdk requires >= 22.13)
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node >= 22.13 (e.g. via nvm)." >&2
  exit 1
fi
NODE_VER="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_REST="${NODE_VER#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "ERROR: Node $NODE_VER found, but >= 22.13 is required (@cursor/sdk)." >&2
  echo "       Upgrade Node (e.g. 'nvm install 22 && nvm use 22') and re-run." >&2
  exit 1
fi
echo "  node:     $NODE_VER (ok)"

# 2. Install dependencies
echo "Installing dependencies..."
( cd "$TOOL_DIR" && npm install --no-fund --no-audit )

# 3. Link the global 'agent-swarm' command
echo "Linking global command 'agent-swarm'..."
( cd "$TOOL_DIR" && npm link )

# 4. Install the personal skill
echo "Installing personal skill to $SKILL_DEST_DIR..."
mkdir -p "$SKILL_DEST_DIR"
cp "$SKILL_SRC" "$SKILL_DEST_DIR/SKILL.md"

echo
echo "Done."
echo "  Try:  agent-swarm --version"
echo "        agent-swarm \"<your goal>\" --dry-run"
echo
if [ -z "${CURSOR_API_KEY:-}" ] && [ ! -f "$TOOL_DIR/.env" ]; then
  echo "Next: set CURSOR_API_KEY (copy $TOOL_DIR/.env.example to .env, or export it)."
fi
