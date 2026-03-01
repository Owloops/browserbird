#!/bin/bash
echo "starting playwright-mcp"

ISOLATION_FLAG=""
if [ "${BROWSER_MODE}" = "isolated" ]; then
    ISOLATION_FLAG="--isolated"
    echo "browser mode: isolated (separate context per session, no saved state)"
else
    echo "browser mode: persistent (shared profile, logins saved across sessions)"
fi

XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
WAYLAND_DISPLAY=wayland-1 \
  playwright-mcp \
    --port 3000 \
    --host 0.0.0.0 \
    --allowed-hosts '*' \
    $ISOLATION_FLAG \
    --config /opt/browserbird/playwright.config.json \
    --init-script /opt/browserbird/stealth.js \
    > /tmp/playwright-mcp.log 2>&1 &

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
