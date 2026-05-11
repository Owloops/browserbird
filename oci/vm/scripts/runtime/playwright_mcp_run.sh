#!/bin/bash
# Wait for sway
timeout=30
while [ $timeout -gt 0 ]; do
    [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
    sleep 1
    ((timeout--))
done
[ $timeout -eq 0 ] && { echo "sway socket not found" >&2; exit 1; }

ARGS=(
    --port 3000
    --host 0.0.0.0
    --allowed-hosts '*'
    --config /opt/browserbird/playwright.config.json
    --init-script /opt/browserbird/stealth.js
    --allow-unrestricted-file-access
)

if [ "${BROWSER_MODE}" = "isolated" ]; then
    ARGS+=(--isolated)
else
    BROWSER_PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
    mkdir -p "$BROWSER_PROFILE"
    rm -f "$BROWSER_PROFILE/SingletonLock"
    ARGS+=(--user-data-dir "$BROWSER_PROFILE")
fi

exec playwright-mcp "${ARGS[@]}"
