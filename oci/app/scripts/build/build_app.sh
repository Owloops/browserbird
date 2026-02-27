#!/bin/bash
set -euo pipefail

echo "Building web UI..."
cd web && npm run build && cd ..

echo "Setting permissions..."
chmod +x oci/app/scripts/runtime/*.sh

echo "Copying agent context..."
cp oci/app/config/agent-context.md CLAUDE.md
cp oci/app/config/agent-context.md AGENTS.md

echo "Copying container config..."
cp oci/app/config/browserbird.json browserbird.json

echo "App build complete"
