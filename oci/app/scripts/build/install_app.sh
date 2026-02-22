#!/bin/bash
set -euo pipefail

echo "Installing Node.js 24 via NodeSource..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg sudo git
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y --no-install-recommends nodejs

echo "Installing global npm packages..."
npm install -g @anthropic-ai/claude-code

rm -rf /var/lib/apt/lists/*

echo "App system installation complete"
