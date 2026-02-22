#!/bin/bash
echo "starting playwright-mcp"

XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
WAYLAND_DISPLAY=wayland-1 \
  playwright-mcp \
    --port 3000 \
    --host 0.0.0.0 \
    --allowed-hosts '*' \
    --config /opt/browserbird/playwright.config.json \
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
