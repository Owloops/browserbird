#!/bin/bash
echo "starting Xvfb"

rm -f /tmp/.X${DISPLAY_NUM}-lock /tmp/.X11-unix/X${DISPLAY_NUM}

Xvfb :${DISPLAY_NUM} -screen 0 ${WIDTH}x${HEIGHT}x24 &

timeout=10
while [ $timeout -gt 0 ]; do
    if [ -e /tmp/.X11-unix/X${DISPLAY_NUM} ]; then
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "Xvfb failed to start" >&2
    exit 1
fi

echo "Xvfb started"
