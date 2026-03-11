#!/bin/bash
# Wait for wayvnc
timeout=30
while [ $timeout -gt 0 ]; do
    ss -tln | grep -q ":5900 " && break
    sleep 1
    ((timeout--))
done
[ $timeout -eq 0 ] && { echo "wayvnc port 5900 not ready" >&2; exit 1; }

exec /opt/noVNC/utils/websockify/run --web /opt/noVNC -6 6080 localhost:5900
