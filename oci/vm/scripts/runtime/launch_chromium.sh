#!/bin/bash
# Single source of truth for manual chromium launch flags.
# Used by sway keybinding and waybar button.
[ -f /tmp/dbus-env ] && . /tmp/dbus-env
PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
exec chromium \
  --user-data-dir="$PROFILE" \
  --disable-gpu \
  --disable-software-rasterizer \
  --in-process-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-crash-reporter \
  --ozone-platform=wayland \
  --disable-blink-features=AutomationControlled
