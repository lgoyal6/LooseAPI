# Setup

There are **two** Gmail integrations in this repo, for two different surfaces.
They need different OAuth clients and they do not share credentials.

| | Surface | Client type | Credential | Scope |
|---|---|---|---|---|
| **A** | `/app` browser scanner | Web application | client ID only (public) | `gmail.readonly` |
| **B** | `spend` CLI + `/spend` dashboard | Desktop app | client id + secret + refresh token | `gmail.modify`, `gmail.settings.basic` |

**A** holds nothing: the token lives in memory for one session and you reconnect
each visit. **B** needs a refresh token because it runs unattended on a
schedule.

Most people want **B**. Set up **A** only if you want the browser scanner too.

**Neither needs a CASA assessment.** CASA applies to *published* apps. An OAuth
client left in **Testing** status serves up to 100 named test users with no
verification.

---

# B. The CLI and dashboard (start here)

## 1. Get a client id and secret

1. <https://console.cloud.google.com/projectcreate> — new project.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **OAuth consent screen** → External → leave publishing status **Testing** →
   add your own address under **Test users**.
4. **Credentials → Create Credentials → OAuth client ID → Desktop app.**
   Copy the client id and secret.

Desktop-app clients accept a loopback redirect on any port, so there is no
redirect URI to register.

## 2. Authorize

```bash
node bin/auth.mjs <client-id> <client-secret>
```

It opens the consent screen, catches the redirect on a local port, exchanges the
code, and merges the refresh token into `~/.devspend/config.json` (mode 600)
without disturbing provider tokens already there.

Google warns that the app is unverified. That is expected for a Testing-status
client — choose **Advanced**, then continue.

**Scopes, and why each is the minimum:**

| Scope | Buys |
|---|---|
| `gmail.modify` | read messages, add labels |
| `gmail.settings.basic` | create filters that label new mail at delivery |

`gmail.modify` is a superset of `gmail.readonly` for everything here, so
requesting both would be redundant. It does **not** grant delete — this tool
cannot remove your mail.

**If no refresh token comes back:** Google issues one only on first
authorization. If the client was already authorized, revoke it at
<https://myaccount.google.com/permissions> and rerun.

Once the credential exists, `spend` switches from `messages.json` to
`gmail-api` automatically. The report header names the source it used.

Only metadata is requested (From / Subject / Date) plus Gmail's own snippet.
Bodies are never fetched. `includeSpamTrash` is on deliberately: billing mail
that lands in Trash is exactly the mail that gets missed.

## 3. Discord alerts

Reuses the bot already registered on this machine rather than adding a webhook:
token from keychain item `AGENTMON_DISCORD_TOKEN`, channel from
`~/.agentmon/state/.discord_dm`. Nothing to configure if those exist.

```bash
spend --digest
```

Only alerts you can still act on are pushed — a balance days from zero, a trial
converting, a failed payment. A charge that already happened stays on the
dashboard, because reading about it sooner changes nothing.

## 4. Schedule it

```bash
launchctl load ~/Library/LaunchAgents/com.laksh.devspend.plist
```

Daily at 09:15, and silent unless something new and actionable appeared.

## 5. Labelling (optional)

Two mechanisms covering different mail. You want both.

```bash
node -e 'import("./lib/mail/filters.mjs").then(m=>m.installFilters({dryRun:true}))'   # preview
node -e 'import("./lib/mail/filters.mjs").then(m=>m.installFilters({dryRun:false}))'  # install
spend --label                                                                          # sweep the backlog
```

| | Applies to | Runs |
|---|---|---|
| Gmail filters | **new mail only** | server-side at delivery, laptop closed |
| `spend --label` | **existing mail** | when you run it |

Filters never touch mail that already arrived, which is why the sweep matters.

Queries live in `lib/mail/filters.mjs` and are mutually exclusive by
construction. Gmail filters have no regex and no ordering — every matching
filter fires — so each lower-priority query carries the negation of the ones
above it. Without that, one email lands in two labels.

Classification rules for the sweep are in `lib/mail/rules.mjs`, ordered
first-match-wins. Both files are meant to be read and edited; the buckets are a
personal filing preference, not a fixed schema.

## 6. Live provider balances (optional)

Add under a `providers` key in `~/.devspend/config.json`. Each adapter skips
cleanly when its token is missing, so partial config is fine.

```json
{
  "providers": {
    "vercelToken": "...",
    "railwayToken": "...",
    "supabaseToken": "...",
    "renderToken": "...",
    "neonToken": "...",
    "cloudflareToken": "...",
    "cloudflareAccountId": "...",
    "anthropicAdminKey": "sk-ant-admin01-..."
  }
}
```

**What cannot be polled, and why.** Verified against the vendor docs on
2026-08-26:

- **Claude Pro/Max and ChatGPT/Codex subscriptions** expose no usage or billing
  API. Receipt email is the only source.
- **Anthropic's cost endpoints are organization-only** — *"The Admin API is
  unavailable for individual accounts."* You would have to convert to an
  organization in Console → Settings → Organization first.

The Railway, Supabase, Render and Neon adapters were written against each
vendor's documented API but have not been executed against a live token, so
expect to tune them on first use.

## 7. API keys

```bash
bin/keys.mjs add <id> <provider> --free-limit 25 --note "what it is for"
bin/keys.mjs list
bin/keys.mjs reveal <id>
```

Secrets go to the macOS Keychain. `~/.devspend/keys.json` holds provider, last
four characters, and your free-tier note. `add` reads the secret from stdin,
never argv, so it stays out of shell history and out of `ps`.

The dashboard renders metadata only and has no code path to a secret.

---

# A. The browser scanner (optional)

Read-only, in the browser, using the Google Identity Services token model. No
secret and no backend credential.

1. Same project and enabled Gmail API as above.
2. **OAuth consent screen → Scopes** → add
   `https://www.googleapis.com/auth/gmail.readonly`.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized JavaScript origins**: `http://localhost:3000`, plus any deployed
   origin later.
5. Copy the **client ID** (public, not a secret).

```bash
cp .env.local.example .env.local
# paste the client ID into NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm run dev
```

Open <http://localhost:3000/app> and click **Connect Gmail**.

The access token lives only in memory for the session. There is no refresh
token, so you reconnect each visit — by design, nothing to store or leak.
Nothing from your inbox reaches any server; verify in DevTools → Network that
the only calls go to `gmail.googleapis.com` directly from the browser.

---

## State on disk

Everything lives in `~/.devspend/`, outside the repo:

| File | Holds |
|---|---|
| `config.json` | credentials (mode 600) |
| `keys.json` | key metadata — never a secret |
| `ledger.json` | every event ever seen, append-only |
| `snapshot.json` | last full result; the dashboard reads this |
| `messages.json` | message dump, used when no Gmail credential is set |
| `state.json` | alert keys already pushed, so the digest stays quiet |

The ledger is append-only on purpose: delete a billing email afterwards and its
history survives, flagged as no longer present in the mailbox.
