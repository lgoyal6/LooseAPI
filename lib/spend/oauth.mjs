/**
 * The Google OAuth pieces that both entry points need.
 *
 * bin/auth.mjs runs the flow by hand on a random port; bin/reconnect.mjs runs
 * it unattended on a fixed one so a Discord link can point at it. The servers
 * differ, everything either of them could get wrong is here: the scope list,
 * the shape of config.json, and the token exchange.
 *
 * The thing this file exists to make impossible is the two of them drifting:
 * a scope added in one place and not the other re-prompts on every run and
 * still fails, which reads exactly like a broken token.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

export const DIR = join(homedir(), ".devspend");
export const CONFIG = join(DIR, "config.json");

/**
 * Google expires a refresh token seven days after it is issued when the client
 * is left in Testing status, which this one is and has to be: both scopes above
 * are "restricted", so leaving Testing means verification plus a CASA
 * assessment. Seven days is therefore a fact of the setup, not a bug to fix.
 * https://developers.google.com/identity/protocols/oauth2
 */
export const TESTING_TTL_MS = 7 * 86400000;

export async function loadCreds() {
  try {
    return JSON.parse(await readFile(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

/**
 * When the current token was issued, and when it dies.
 *
 * `authorizedAt` is written by save() below, but the config that is live today
 * predates it, so fall back to the file's mtime. That is only wrong if
 * something else rewrote config.json without re-authorising (provider keys do
 * land here), and being a few hours pessimistic costs one early warning, while
 * having no estimate at all costs the whole point of warning early.
 */
export async function tokenLife(cfg = {}) {
  let issued = cfg.authorizedAt ? Date.parse(cfg.authorizedAt) : NaN;
  if (Number.isNaN(issued)) {
    issued = await stat(CONFIG).then((s) => s.mtimeMs).catch(() => NaN);
  }
  if (Number.isNaN(issued)) return { issued: null, expires: null, msLeft: null, estimated: true };
  return {
    issued: new Date(issued).toISOString(),
    expires: new Date(issued + TESTING_TTL_MS).toISOString(),
    msLeft: issued + TESTING_TTL_MS - Date.now(),
    estimated: !cfg.authorizedAt,
  };
}

/**
 * Ask Google whether the refresh token is still good.
 *
 * Distinguishes a dead token from an unreachable network, because they want
 * opposite responses: one needs a human at a consent screen, the other needs
 * to be ignored until the next run. Conflating them is how a flaky minute
 * turns into a Discord ping telling you to re-authorise something that is fine.
 */
export async function probe({ clientId, clientSecret, refreshToken } = {}) {
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, expired: true, reason: "no credentials in config.json" };
  }
  let res;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (error) {
    return { ok: false, expired: false, reason: `unreachable: ${error.message}` };
  }
  if (res.ok) return { ok: true, expired: false, reason: "ok" };
  const body = await res.text();
  // invalid_grant is the only answer that means "a human must click consent".
  // Any other status is Google being unhappy for a reason a retry may survive.
  return {
    ok: false,
    expired: /invalid_grant/.test(body),
    reason: `HTTP ${res.status}: ${body.replace(/\s+/g, " ").slice(0, 160)}`,
  };
}

export function consentUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); // required for a refresh token
  url.searchParams.set("prompt", "consent"); // force one even on re-auth
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  return { ok: res.ok, body: await res.json() };
}

/**
 * Merge rather than overwrite: config.json also holds provider tokens, and this
 * file is not their owner.
 */
export async function save({ clientId, clientSecret, refreshToken }) {
  await mkdir(DIR, { recursive: true });
  const existing = await loadCreds();
  await writeFile(
    CONFIG,
    JSON.stringify(
      { ...existing, clientId, clientSecret, refreshToken, authorizedAt: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
