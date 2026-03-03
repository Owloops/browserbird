#!/bin/bash
set -e

if [ "$(id -u)" = "0" ]; then
  chown "$USERNAME:$USERNAME" "/home/$USERNAME/.browserbird"
  exec gosu "$USERNAME" "$0" "$@"
fi

export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
export WAYLAND_DISPLAY=wayland-1
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

eval $(dbus-launch)
export DBUS_SESSION_BUS_ADDRESS

SCRIPTS=/opt/browserbird/runtime

"$SCRIPTS/sway_startup.sh"
"$SCRIPTS/wayvnc_startup.sh"
"$SCRIPTS/novnc_startup.sh"
"$SCRIPTS/playwright_mcp_startup.sh"

echo "VM stack ready"
echo "VNC:           localhost:5900"
echo "noVNC:         localhost:6080"
echo "Playwright MCP: localhost:3000"

trap 'kill $(jobs -p) 2>/dev/null; wait' TERM INT

sleep infinity
