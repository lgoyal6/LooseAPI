#!/usr/bin/env bash
# Waits for a Google client secret to appear on the clipboard, then runs the
# OAuth flow. Removes the coordination problem: copy from the console and this
# fires on its own. The secret goes clipboard -> pipe -> process; it is never
# printed, never on argv, never in shell history.
set -uo pipefail
CLIENT_ID="${1:?usage: await-secret.sh <client-id>}"
DEADLINE=$(( $(date +%s) + 600 ))

echo "watching the clipboard for a GOCSPX- secret (10 min)…"
echo "copy the Client secret from https://console.cloud.google.com/auth/clients?project=looseapi-mail"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if pbpaste 2>/dev/null | head -c 7 | grep -q '^GOCSPX-'; then
    echo "secret detected — starting OAuth"
    exec sh -c "pbpaste | node '$(pwd)/bin/auth.mjs' '$CLIENT_ID'"
  fi
  sleep 2
done
echo "timed out with nothing on the clipboard"
exit 1
