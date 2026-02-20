#!/bin/bash
set -e

export DISPLAY=:${DISPLAY_NUM:-1}
eval $(dbus-launch)
export DBUS_SESSION_BUS_ADDRESS

./docker/scripts/runtime/xvfb_startup.sh
./docker/scripts/runtime/tint2_startup.sh
./docker/scripts/runtime/mutter_startup.sh
./docker/scripts/runtime/x11vnc_startup.sh
./docker/scripts/runtime/novnc_startup.sh

echo "VNC stack ready"
echo "VNC: localhost:5900"
echo "noVNC: localhost:6080"

trap 'kill $(jobs -p) 2>/dev/null; wait' TERM INT

exec node --disable-warning=ExperimentalWarning ./bin/browserbird start --config docker/config/browserbird/browserbird.json
