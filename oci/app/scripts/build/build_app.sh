#!/bin/bash
set -euo pipefail

echo "Building backend..."
npm run build

echo "Building web UI..."
cd web && npm run build && cd ..

echo "Setting permissions..."
chmod +x oci/app/scripts/runtime/*.sh

echo "Copying agent context..."
cp oci/app/config/agent-context.md CLAUDE.md
cp oci/app/config/agent-context.md AGENTS.md
cp oci/app/config/slack-api.md slack-api.md
cp oci/app/config/cli-reference.md cli-reference.md

echo "App build complete"
