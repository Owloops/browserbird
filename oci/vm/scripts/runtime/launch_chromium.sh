#!/bin/bash
# Single source of truth for manual browser launch flags.
# Used by sway keybinding and waybar button.
# Uses Playwright's bundled Chrome (not system chromium) for compatibility.
[ -f /tmp/dbus-env ] && . /tmp/dbus-env
PROFILE="/home/${USERNAME:-bbuser}/.browserbird/browser-profile"
rm -f "$PROFILE/SingletonLock"
exec /opt/google/chrome/chrome \
  --user-data-dir="$PROFILE" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-breakpad \
  --disable-field-trial-config \
  --ozone-platform=wayland \
  --disable-blink-features=AutomationControlled
