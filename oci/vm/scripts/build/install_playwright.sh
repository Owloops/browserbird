#!/bin/bash
set -euo pipefail

echo "Installing Playwright Chromium..."
npx playwright-core install chromium

echo "Symlinking Chromium binary..."
sudo ln -s "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux64/chrome /usr/local/bin/chromium

echo "Playwright installation complete"
