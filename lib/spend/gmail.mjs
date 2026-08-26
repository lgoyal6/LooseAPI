/**
 * Gmail metadata fetch. Two sources, tried in order:
 *
 *   1. A refresh token in ~/.devspend/config.json -> live, unattended, what the
 *      scheduled run uses.
 *   2. ~/.devspend/messages.json -> a dump written by something else (a Claude
 *      session with the Gmail MCP, or `spend import`).
 *
 * The fallback exists so the tool is useful before the OAuth client is set up:
 * you get the full report today and automate it later, rather than the setup
 * being a gate on any value at all.
 *
 * Only metadata is requested (From/Subject/Date) plus Gmail's own snippet.
 * Bodies are never fetched.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".devspend");
const CONFIG = join(DIR, "config.json");
const DUMP = join(DIR, "messages.json");

/** Billing-shaped mail only. Keeps the scan small and the token cost near zero. */
export const QUERY = [
  "(",
  [
    "subject:(receipt OR invoice OR billing OR payment OR charged)",
    "subject:(credits OR credit balance OR free plan OR trial)",
    '"amount paid"',
    '"credits remaining"',
    '"has been closed"',
    '"payment failed"',
    '"trial ends"',
  ].join(" OR "),
  ")",
  "-in:spam",
].join(" ");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function loadConfig() {
  return (await readJson(CONFIG)) || {};
}

/** Exchange a refresh token for a short-lived access token. */
async function accessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).access_token;
}

function headerMap(payload) {
  const out = {};
  for (const h of payload?.headers || []) out[h.name.toLowerCase()] = h.value;
  return out;
}

async function fetchLive(cfg, { days }) {
  const token = await accessToken(cfg);
  const auth = { authorization: `Bearer ${token}` };
  const after = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
  const q = `${QUERY} after:${after}`;

  const ids = [];
  let pageToken;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("includeSpamTrash", "true"); // the AWS mail was in Trash
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const m of body.messages || []) ids.push(m.id);
    pageToken = body.nextPageToken;
  } while (pageToken && ids.length < 500);

  const messages = [];
  for (const id of ids) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    url.searchParams.set("format", "metadata");
    for (const h of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", h);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) continue;
    const m = await res.json();
    const h = headerMap(m.payload);
    messages.push({
      id: m.id,
      from: h.from || "",
      subject: h.subject || "",
      snippet: m.snippet || "",
      date: new Date(Number(m.internalDate)).toISOString(),
      labelIds: m.labelIds || [],
    });
  }
  return messages;
}

/**
 * @returns {Promise<{messages:Array, source:string}>}
 */
export async function fetchMessages({ days = 120 } = {}) {
  const cfg = await loadConfig();
  if (cfg.clientId && cfg.clientSecret && cfg.refreshToken) {
    return { messages: await fetchLive(cfg, { days }), source: "gmail-api" };
  }
  const dump = await readJson(DUMP);
  if (Array.isArray(dump)) return { messages: dump, source: "messages.json" };
  if (dump && Array.isArray(dump.messages)) return { messages: dump.messages, source: "messages.json" };
  return { messages: [], source: "none" };
}
