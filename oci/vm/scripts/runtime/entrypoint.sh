#!/bin/bash
set -e

export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
mkdir -p "$XDG_RUNTIME_DIR"
chown ${USERNAME:-bbuser}:${USERNAME:-bbuser} "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

chown ${USERNAME:-bbuser}:${USERNAME:-bbuser} /home/${USERNAME:-bbuser}/.browserbird || true

exec supervisord -c /opt/browserbird/supervisord.conf
