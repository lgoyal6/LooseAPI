# LooseApi

Map your email's footprint. LooseApi scans your Gmail **locally, in the browser**
to surface every dev tool, free tier, subscription, and trial your address is tied
to — and flags the ones quietly about to charge you.

> **The wedge:** not a generic subscription tracker, but the money developers
> leave on the table — forgotten free-tier signups, trials converting to paid, and
> (later) unused API/cloud credits — for individuals, from their personal inbox.

## Principles

- **Local-first** — raw inbox content never leaves your device. The only Google
  credential held is a short-lived, in-memory access token (GIS token model).
- **Connect, don't custody** — later credit features use read-only tokens through
  a stateless proxy; never a server-side secrets vault.
- **Self-lookup only** — your inbox, your footprint. Never arbitrary emails.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB).

## Run it

See [SETUP.md](./SETUP.md) for the one-time Google OAuth setup (~5 min), then:

```bash
npm install
cp .env.local.example .env.local   # add your NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm run dev
```

Visit `/` for the landing page or `/app` to scan.

## How it works (v1)

1. **Connect** — GIS issues a read-only Gmail access token in the browser.
2. **Fetch** — `messages.list` + metadata `get` (From/Subject/Date) directly over
   CORS. No bodies, nothing to our servers.
3. **Parse** — a service-signature dictionary (`lib/services.ts`) + subject rules
   classify each email and dedupe into services with tier + dormancy.
4. **View** — a dashboard (counts, "needs attention", filters) and a footprint
   graph (hub-and-spoke, colored by tier).
5. **Persist** — results stored locally in IndexedDB; "Wipe" clears everything.

## Roadmap

- **v2** enrich detection (Claude classification of unknown senders via stateless
  proxy; HIBP for the deleted-email tail; trial-date extraction).
- **v3** alerts (thin cloud layer stores only `{contact, service, date}`).
- **v4** credits — read-only connectors for OpenAI/AWS/GCP/Azure ("$100 leftover").
- **v5** universal paid-subscription detection via Plaid (opt-in, hybrid).

## Project layout

```
app/            landing (/) and scanner (/app)
components/     Dashboard, FootprintGraph, StatTile, TierBadge
lib/            config, google-auth, gmail, services (dictionary),
                parser, db (Dexie), scan (orchestrator), tiers, types
```
