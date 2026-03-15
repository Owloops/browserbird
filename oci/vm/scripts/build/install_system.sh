#!/bin/bash
set -euo pipefail

echo "Installing Node.js 24 via NodeSource..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y --no-install-recommends nodejs

echo "Installing global npm packages..."
npm install -g @playwright/mcp

echo "Installing system dependencies..."
npx playwright-core install-deps chromium
apt-get install -y --no-install-recommends \
  sway wayvnc cage waybar foot neovim sudo gosu python3 net-tools supervisor \
  fonts-noto-core fonts-noto-color-emoji fonts-font-awesome fontconfig dbus-x11 xdg-utils git
rm -rf /var/lib/apt/lists/*

echo "Suppressing Chromium command-line flag warnings..."
mkdir -p /etc/chromium/policies/managed /etc/opt/chrome/policies/managed
POLICY='{"CommandLineFlagSecurityWarningsEnabled": false}'
echo "$POLICY" > /etc/chromium/policies/managed/browserbird.json
echo "$POLICY" > /etc/opt/chrome/policies/managed/browserbird.json

echo "Installing noVNC..."
git -c advice.detachedHead=false clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/noVNC
git -c advice.detachedHead=false clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify
rm -rf /opt/noVNC/.git /opt/noVNC/utils/websockify/.git

echo "System installation complete"
