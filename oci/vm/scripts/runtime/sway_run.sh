#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser
export WLR_BACKENDS=headless
export WLR_LIBINPUT_NO_DEVICES=1

eval $(dbus-launch)
export DBUS_SESSION_BUS_ADDRESS

exec sway --config /home/${USERNAME:-bbuser}/.config/sway/config
