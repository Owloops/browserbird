#!/bin/bash
echo "starting x11vnc"

(x11vnc -display $DISPLAY \
    -forever \
    -shared \
    -wait 50 \
    -rfbport 5900 \
    -nopw \
    2>/tmp/x11vnc_stderr.log) &

timeout=10
while [ $timeout -gt 0 ]; do
    if netstat -tuln | grep -q ":5900 "; then
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "x11vnc failed to start" >&2
    cat /tmp/x11vnc_stderr.log >&2
    exit 1
fi

echo "x11vnc started"
