#!/bin/bash
set -e

CONFIG_DIR="/app/.browserbird"
CONFIG_PATH="$CONFIG_DIR/browserbird.json"

chown "$USERNAME:$USERNAME" "$CONFIG_DIR" || true

if [ ! -f "$CONFIG_PATH" ]; then
  cp oci/app/config/browserbird.json "$CONFIG_PATH"
  chown "$USERNAME:$USERNAME" "$CONFIG_PATH" || true
fi

export BROWSERBIRD_CONFIG="$CONFIG_PATH"

exec gosu "$USERNAME" node --disable-warning=ExperimentalWarning ./bin/browserbird
