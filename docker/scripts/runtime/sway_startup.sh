#!/bin/bash
echo "starting sway"

WLR_BACKENDS=headless \
WLR_LIBINPUT_NO_DEVICES=1 \
XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
  sway --config /home/bbuser/.config/sway/config 2>/tmp/sway.log &

timeout=10
while [ $timeout -gt 0 ]; do
    if [ -S "/tmp/xdg-runtime-bbuser/wayland-1" ]; then
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "sway failed to start" >&2
    cat /tmp/sway.log >&2
    exit 1
fi

echo "sway started"
