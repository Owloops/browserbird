#!/bin/bash
set -e

CONFIG_DIR="/app/.browserbird"
CONFIG_PATH="$CONFIG_DIR/browserbird.json"

if [ ! -f "$CONFIG_PATH" ]; then
  mkdir -p "$CONFIG_DIR"
  cp oci/app/config/browserbird.json "$CONFIG_PATH"
fi

export BROWSERBIRD_CONFIG="$CONFIG_PATH"

exec node --disable-warning=ExperimentalWarning ./bin/browserbird
