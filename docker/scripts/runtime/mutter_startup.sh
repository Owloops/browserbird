#!/bin/bash
echo "starting mutter"

XDG_SESSION_TYPE=x11 mutter --replace --sm-disable 2>/dev/null &
sleep 2

echo "mutter started"
