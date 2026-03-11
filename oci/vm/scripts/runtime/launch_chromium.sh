#!/bin/bash
# Single source of truth for manual chromium launch flags.
# Used by sway keybinding and waybar button.
[ -f /tmp/dbus-env ] && . /tmp/dbus-env
PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
exec chromium \
  --user-data-dir="$PROFILE" \
  --use-gl=disabled \
  --disable-gpu-compositing \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-breakpad \
  --ozone-platform=wayland \
  --disable-blink-features=AutomationControlled
