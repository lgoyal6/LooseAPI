# Setup — Google OAuth (one-time, ~5 minutes)

LooseApi reads Gmail **read-only, in the browser**, using the Google Identity
Services token model. To run it locally you need a Google OAuth **client ID**
(public — not a secret). No API key or backend credential is required.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a new project.

## 2. Enable the Gmail API

1. **APIs & Services → Library** → search "Gmail API" → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Fill app name, support email, developer email.
3. **Scopes** → Add `https://www.googleapis.com/auth/gmail.readonly`.
   - ⚠️ This is a **restricted** scope. For local dev with test users you do
     NOT need verification. To ship publicly you must pass a CASA security
     assessment (see the project plan) — start that early.
4. **Test users** → add your own Google account (and up to 100 others). Only
   test users can sign in until the app is verified.

## 4. Create the OAuth client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: add `http://localhost:3000`
   (and your deployed origin later, e.g. `https://looseapi.vercel.app`).
4. Create → copy the **Client ID**.

## 5. Wire it up

```bash
cp .env.local.example .env.local
# paste the client ID into NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm run dev
```

Open <http://localhost:3000/app> and click **Connect Gmail**.

## Notes

- The access token lives only in memory for the session; there is no refresh
  token, so you re-connect each visit (by design — nothing to store or leak).
- Nothing from your inbox is sent to any server. Verify it yourself in DevTools →
  Network: the only calls are to `gmail.googleapis.com` directly from your browser.
