#!/bin/bash
echo "starting wayvnc"

XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
WAYLAND_DISPLAY=wayland-1 \
  wayvnc 0.0.0.0 5900 2>/tmp/wayvnc.log &

timeout=10
while [ $timeout -gt 0 ]; do
    if netstat -tuln | grep -q ":5900 "; then
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "wayvnc failed to start" >&2
    cat /tmp/wayvnc.log >&2
    exit 1
fi

echo "wayvnc started"
