#!/bin/bash
set -euo pipefail

echo "Creating user $USERNAME..."
useradd -m -s /bin/bash -d "/home/$USERNAME" "$USERNAME"
echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

echo "User $USERNAME created"
