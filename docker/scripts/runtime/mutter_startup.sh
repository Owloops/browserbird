#!/bin/bash
echo "starting mutter"

mutter --replace --sm-disable 2>/dev/null &
sleep 2

echo "mutter started"
