#!/bin/bash
set -euo pipefail

echo "Installing Playwright Chromium..."
npx playwright-core install chromium

echo "Installing Google Chrome (for manual VNC launch)..."
npx playwright-core install chrome

echo "Playwright installation complete"
