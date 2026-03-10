#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
export WAYLAND_DISPLAY=wayland-1
export PLAYWRIGHT_MCP_PORT=3000
export PLAYWRIGHT_MCP_HOST=0.0.0.0
export PLAYWRIGHT_MCP_ALLOWED_HOSTNAMES='*'
export PLAYWRIGHT_MCP_CONFIG=/opt/browserbird/playwright.config.json
export PLAYWRIGHT_MCP_INIT_SCRIPT=/opt/browserbird/stealth.js

# Wait for sway
timeout=30
while [ $timeout -gt 0 ]; do
    [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
    sleep 1
    ((timeout--))
done
[ $timeout -eq 0 ] && { echo "sway socket not found" >&2; exit 1; }

# Handle browser mode
if [ "${BROWSER_MODE}" = "isolated" ]; then
    export PLAYWRIGHT_MCP_ISOLATED=true
else
    BROWSER_PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
    mkdir -p "$BROWSER_PROFILE"
    rm -f "$BROWSER_PROFILE/SingletonLock"
    export PLAYWRIGHT_MCP_USER_DATA_DIR="$BROWSER_PROFILE"
fi

exec playwright-mcp
