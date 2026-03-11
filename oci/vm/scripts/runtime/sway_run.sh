#!/bin/bash
export WLR_BACKENDS=headless
export WLR_LIBINPUT_NO_DEVICES=1

exec dbus-run-session sway --config /home/${USERNAME:-bbuser}/.config/sway/config
