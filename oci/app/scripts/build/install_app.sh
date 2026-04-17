#!/bin/bash
set -euo pipefail

# archive.ubuntu.com round-robin has produced sustained Hash Sum mismatches during mirror
# sync windows. Pin priority:1 to Azure (colocated with GHA runners); apt's mirror+file:
# protocol falls through to the next entry on per-file failure. Mirrors the GitHub Actions
# runner-images apt configuration.
{
  printf 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
  printf 'http://archive.ubuntu.com/ubuntu/\tpriority:2\n'
  printf 'http://security.ubuntu.com/ubuntu/\tpriority:3\n'
} > /etc/apt/apt-mirrors.txt
for src in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do
  [ -f "$src" ] && sed -i -E 's#https?://(archive|security)\.ubuntu\.com/ubuntu/?#mirror+file:/etc/apt/apt-mirrors.txt#g' "$src"
done
# Pipeline-Depth 0 avoids hash mismatches through broken proxies (Debian #565555).
cat > /etc/apt/apt.conf.d/80-ci-resilience <<'EOF'
APT::Acquire::Retries "10";
Acquire::http::Pipeline-Depth "0";
Acquire::http::No-Cache "true";
Acquire::https::Pipeline-Depth "0";
Acquire::https::No-Cache "true";
Acquire::BrokenProxy "true";
EOF

echo "Installing Node.js 24 via NodeSource..."
# Retry apt-get update: apt 2.7 on Ubuntu 24.04 does not fall back through mirror+file:
# on HashSumMismatch, and stale /var/lib/apt/lists from an aborted fetch reproduces the
# same error (Launchpad #2107223). Clear state between attempts.
for attempt in 1 2 3 4 5; do
  apt-get update && break
  [ "$attempt" -eq 5 ] && { echo "apt-get update failed after 5 attempts" >&2; exit 1; }
  apt-get clean
  rm -rf /var/lib/apt/lists/*
  sleep $((attempt * 5))
done
apt-get install -y --no-install-recommends ca-certificates curl gnupg sudo git gosu fontconfig fonts-comfortaa
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y --no-install-recommends nodejs

echo "Installing global npm packages..."
npm install -g @anthropic-ai/claude-code@latest

rm -rf /var/lib/apt/lists/*

echo "App system installation complete"
