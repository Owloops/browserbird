#!/bin/bash
set -euo pipefail

echo "Building web UI..."
cd web && npm run build && cd ..

echo "Setting permissions..."
chmod +x docker/scripts/runtime/*.sh

echo "Copying agent context..."
cp docker/config/browserbird/agent-context.md CLAUDE.md
cp docker/config/browserbird/agent-context.md AGENTS.md

echo "App build complete"
