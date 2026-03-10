#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
export WAYLAND_DISPLAY=wayland-1

# Wait for sway
timeout=30
while [ $timeout -gt 0 ]; do
    [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
    sleep 1
    ((timeout--))
done
[ $timeout -eq 0 ] && { echo "sway socket not found" >&2; exit 1; }

exec wayvnc 0.0.0.0 5900
