#!/bin/bash
set -euo pipefail

echo "Installing global npm packages..."
npm install -g @anthropic-ai/claude-code @playwright/mcp

echo "Installing system dependencies..."
npx playwright-core install-deps chromium
apt-get install -y --no-install-recommends \
  xvfb x11vnc mutter tint2 xterm neovim sudo python3 net-tools \
  fonts-noto-color-emoji dbus-x11
rm -rf /var/lib/apt/lists/*

echo "Installing noVNC..."
git clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/noVNC
git clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify
rm -rf /opt/noVNC/.git /opt/noVNC/utils/websockify/.git

echo "System installation complete"
