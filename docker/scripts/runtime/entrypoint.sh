#!/bin/bash
set -e

export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
export WAYLAND_DISPLAY=wayland-1
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

eval $(dbus-launch)
export DBUS_SESSION_BUS_ADDRESS

./docker/scripts/runtime/sway_startup.sh
./docker/scripts/runtime/wayvnc_startup.sh
./docker/scripts/runtime/novnc_startup.sh

echo "VNC stack ready"
echo "VNC: localhost:5900"
echo "noVNC: localhost:6080"

trap 'kill $(jobs -p) 2>/dev/null; wait' TERM INT

exec node --disable-warning=ExperimentalWarning ./bin/browserbird start --config docker/config/browserbird/browserbird.json
