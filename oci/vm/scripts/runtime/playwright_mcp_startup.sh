#!/bin/bash
echo "starting playwright-mcp"

export PLAYWRIGHT_MCP_PORT=3000
export PLAYWRIGHT_MCP_HOST=0.0.0.0
export PLAYWRIGHT_MCP_ALLOWED_HOSTNAMES='*'
export PLAYWRIGHT_MCP_CONFIG=/opt/browserbird/playwright.config.json
export PLAYWRIGHT_MCP_INIT_SCRIPT=/opt/browserbird/stealth.js

if [ "${BROWSER_MODE}" = "isolated" ]; then
    export PLAYWRIGHT_MCP_ISOLATED=true
    echo "browser mode: isolated (separate context per session, no saved state)"
else
    BROWSER_PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
    mkdir -p "$BROWSER_PROFILE"
    rm -f "$BROWSER_PROFILE/SingletonLock"
    export PLAYWRIGHT_MCP_USER_DATA_DIR="$BROWSER_PROFILE"
    echo "browser mode: persistent (shared profile, logins saved across sessions)"
fi

XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
WAYLAND_DISPLAY=wayland-1 \
  playwright-mcp > /tmp/playwright-mcp.log 2>&1 &

timeout=15
while [ $timeout -gt 0 ]; do
    if netstat -tuln | grep -q ":3000 "; then
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "playwright-mcp failed to start" >&2
    cat /tmp/playwright-mcp.log >&2
    exit 1
fi

echo "playwright-mcp started"
