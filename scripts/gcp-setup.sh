#!/usr/bin/env bash
# Provisions everything for the Gmail OAuth client that gcloud can actually do.
#
# Desktop-app OAuth clients cannot be created from the CLI — `gcloud iam
# oauth-clients` covers workforce identity federation, not this — so the last
# two steps are console-only and this script deep-links straight to them
# instead of pretending otherwise.
set -euo pipefail

PROJECT="${1:-looseapi-mail}"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }

command -v gcloud >/dev/null || { echo "gcloud not on PATH — open a new shell or: brew install --cask gcloud-cli"; exit 1; }

step "1/4  Account"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  echo "  no active account — run this first, it needs a browser:"
  echo "      gcloud auth login"
  exit 1
fi
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)
ok "signed in as $ACCOUNT"

step "2/4  Project"
if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  ok "$PROJECT already exists"
else
  gcloud projects create "$PROJECT" --name="LooseApi Mail" --quiet
  ok "created $PROJECT"
fi
gcloud config set project "$PROJECT" --quiet 2>/dev/null
ok "active project set"

step "3/4  Gmail API"
if gcloud services list --enabled --filter='config.name:gmail.googleapis.com' --format='value(config.name)' 2>/dev/null | grep -q gmail; then
  ok "already enabled"
else
  gcloud services enable gmail.googleapis.com --quiet
  ok "enabled gmail.googleapis.com"
fi

step "4/4  Console steps — these two cannot be scripted"
cat <<EOF

  a) OAuth consent screen
     https://console.cloud.google.com/auth/overview?project=$PROJECT

     User type            External
     Publishing status    leave as Testing      <- this is what avoids CASA
     Test users           add $ACCOUNT

     No scopes need adding here; the auth helper requests them at run time.

  b) Create the client
     https://console.cloud.google.com/auth/clients/create?project=$PROJECT

     Application type     Desktop app
     Name                 anything

     Copy the client ID and client secret, then:

         node bin/auth.mjs <client-id> <client-secret>

EOF
