#!/bin/bash
export WLR_BACKENDS=headless
export WLR_LIBINPUT_NO_DEVICES=1

eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS
echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" > /tmp/dbus-env

exec sway --config /home/${USERNAME:-bbuser}/.config/sway/config
