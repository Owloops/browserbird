#!/bin/bash
set -euo pipefail

echo "Installing Playwright Chromium..."
npx playwright-core install chromium

# TODO: remove arch guard when Chrome ships arm64 support (expected Q2 2026)
if [ "$(uname -m)" = "x86_64" ]; then
  echo "Installing Google Chrome (for manual VNC launch)..."
  npx playwright-core install chrome
else
  echo "Skipping Google Chrome install (not available for $(uname -m))"
fi

echo "Playwright installation complete"
