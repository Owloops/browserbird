#!/bin/bash
set -euo pipefail

# Use the playwright-core bundled with @playwright/mcp so we install the
# Chromium revision that mcp's bundled core expects. Installing latest
# playwright-core via npx pulls a different revision and mcp reports
# "Browser 'chromium' is not installed" at runtime.
PW_CLI="$(npm root -g)/@playwright/mcp/node_modules/playwright-core/cli.js"

if [ ! -f "$PW_CLI" ]; then
  echo "Cannot find playwright-core CLI at $PW_CLI" >&2
  echo "Is @playwright/mcp installed globally?" >&2
  exit 1
fi

echo "Installing Playwright Chromium (via mcp's bundled playwright-core)..."
node "$PW_CLI" install chromium

# TODO: remove arch guard when Chrome ships arm64 support (expected Q2 2026)
if [ "$(uname -m)" = "x86_64" ]; then
  echo "Installing Google Chrome (for manual VNC launch)..."
  node "$PW_CLI" install chrome
else
  echo "Skipping Google Chrome install (not available for $(uname -m))"
fi

echo "Playwright installation complete"
