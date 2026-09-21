#!/usr/bin/env node
/**
 * Gmail re-authorisation, reduced to one click.
 *
 *   reconnect --check    decide whether to warn, open a window, post to Discord
 *   reconnect --serve    hold the window open, headless (what --check spawns)
 *   reconnect            open a window and the consent screen right now
 *
 * The problem this solves is not that re-auth is hard. It is that the token
 * dies every seven days (see TESTING_TTL_MS in lib/spend/oauth.mjs), nothing
 * said so, and the failure is invisible from outside: the snapshot just stops
 * advancing and the dashboard keeps showing a stale number as though it were
 * today's. It ran red four times a day for a week in September 2026 before
 * anyone looked at the log.
 *
 * So: warn a day before the token dies rather than after, and make the fix a
 * link instead of a terminal. The consent click itself is irreducible, because
 * Google requires a human at that screen and no amount of local automation
 * removes it, but everything either side of the click is automated, including
 * the catch-up scan that would otherwise wait for the next schedule.
 *
 * The window binds 127.0.0.1 only. The OAuth redirect has to come back to
 * loopback on this machine, so a phone on the tailnet could open the consent
 * screen but never complete it; binding wider would just add an open port and
 * a more confusing way to fail.
 */
import { createServer } from "node:http";
import { connect } from "node:net";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CONFIG,
  DIR,
  consentUrl,
  exchangeCode,
  loadCreds,
  probe,
  save,
  tokenLife,
} from "../lib/spend/oauth.mjs";
import { send as discordSend } from "../lib/spend/notify.mjs";

const PORT = 47321;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const START = `${ORIGIN}/start`;

/** How long a window stays open. Matches the 6h refresh cadence, so a missed
 *  click is never more than one scheduled check away from a fresh window. */
const WINDOW_MS = 6 * 3600_000;

/** Warn this far ahead of expiry, while the token still works. */
const WARN_MS = 24 * 3600_000;

/** Never re-post about the same unresolved incident more often than this. */
const RENOTIFY_MS = 20 * 3600_000;

const STATE = join(DIR, "auth-state.json");
const SPEND = join(dirname(fileURLToPath(import.meta.url)), "spend.mjs");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const hours = (ms) => (ms >= 86400_000 ? `${Math.round(ms / 86400_000)}d` : `${Math.round(ms / 3600_000)}h`);

async function readState() {
  try {
    return JSON.parse(await readFile(STATE, "utf8"));
  } catch {
    return {};
  }
}

const writeState = (s) => writeFile(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });

/** Is a window already listening? Cheaper and more honest than trying to bind
 *  and reading EADDRINUSE off a half-built server. */
function windowOpen() {
  return new Promise((resolve) => {
    const sock = connect({ port: PORT, host: "127.0.0.1" })
      .on("connect", () => (sock.destroy(), resolve(true)))
      .on("error", () => resolve(false));
    sock.setTimeout(500, () => (sock.destroy(), resolve(false)));
  });
}

/**
 * Refresh the snapshot the moment the token is good again.
 *
 * Without this the reconnect looks like it did nothing: the dashboard keeps its
 * stale tile until the next scheduled run, which can be six hours later, and
 * the natural reading of that is that the fix failed.
 */
function healScan() {
  return new Promise((resolve) => {
    execFile(process.execPath, [SPEND, "--json"], { timeout: 180_000 }, (err) =>
      resolve(err ? `scan failed: ${err.message.split("\n")[0]}` : null),
    );
  });
}

/** The window. Resolves when it is done, either way. */
async function serve({ openBrowser }) {
  const cfg = await loadCreds();
  if (!cfg.clientId || !cfg.clientSecret) {
    console.error("no client id/secret in config.json; run `node bin/auth.mjs <id> <secret>` first");
    process.exit(1);
  }

  let state = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, ORIGIN);
    const html = (code, body) => res.writeHead(code, { "content-type": "text/html" }).end(body);

    // The human entry point. A short link survives a Discord message; the
    // 400-character Google URL does not, and is unclickable on a phone anyway.
    if (url.pathname === "/start") {
      state = randomBytes(16).toString("hex");
      const to = consentUrl({ clientId: cfg.clientId, redirectUri: ORIGIN, state });
      return res.writeHead(302, { location: to }).end();
    }

    if (url.pathname !== "/") return html(404, "<h2>Not here</h2>");

    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (err || !state || url.searchParams.get("state") !== state || !code) {
      return html(400, `<h2>Authorization failed</h2><p>${err ?? "bad state or missing code"}</p>
        <p><a href="/start">Start again</a></p>`);
    }

    const { ok, body } = await exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri: ORIGIN,
    });
    if (!ok || !body.refresh_token) {
      // No refresh_token on an otherwise-fine response means this client is
      // already authorized and Google saw no need to mint another.
      const hint = ok
        ? "Already authorized; revoke it at myaccount.google.com/permissions and retry."
        : JSON.stringify(body).slice(0, 200);
      return html(500, `<h2>Token exchange failed</h2><p>${hint}</p>`);
    }

    await save({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: body.refresh_token });
    const life = await tokenLife(await loadCreds());
    html(200, `<h2>Reconnected.</h2><p>Good for ${hours(life.msLeft)}, until ${new Date(life.expires).toLocaleString()}.</p>
      <p>Refreshing the snapshot now, you can close this tab.</p>`);

    const failed = await healScan();
    await writeState({});
    await discordSend(
      failed
        ? `✅ **devspend** Gmail reconnected, good for ${hours(life.msLeft)}.\n⚠️ catch-up ${failed}`
        : `✅ **devspend** Gmail reconnected and the snapshot is current again. Good for ${hours(life.msLeft)}, until ${new Date(life.expires).toLocaleString()}.`,
    );
    console.log(`reconnected; token written to ${CONFIG}${failed ? ` (${failed})` : ", snapshot refreshed"}`);
    server.close();
    process.exit(0);
  });

  server.on("error", (e) => {
    // Another window got there first, which is a success for our purposes.
    console.error(e.code === "EADDRINUSE" ? `a window is already open at ${START}` : `listen failed: ${e.message}`);
    process.exit(e.code === "EADDRINUSE" ? 0 : 1);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`reconnect window open at ${START} for ${hours(WINDOW_MS)}`);
    if (openBrowser) execFile("open", [START], () => {});
  });

  // Do not sit on the port forever. A stale listener outliving its Discord
  // message is a link that looks live and reconnects nothing.
  setTimeout(() => {
    console.log("window expired, nobody clicked");
    server.close();
    process.exit(0);
  }, WINDOW_MS).unref?.();
}

/**
 * Decide whether to say anything. Runs on every scheduled scan, so silence is
 * the overwhelmingly common outcome and the bar for breaking it is high.
 */
async function check() {
  const cfg = await loadCreds();
  const [status, life, state] = await Promise.all([probe(cfg), tokenLife(cfg), readState()]);

  // A token that works and is not close to dying is the whole point. Say nothing.
  if (status.ok && (life.msLeft === null || life.msLeft > WARN_MS)) {
    if (state.incident) await writeState({}); // recovered on its own
    console.log(`auth ok${life.msLeft ? `, ${hours(life.msLeft)} left` : ""}`);
    return;
  }

  // Google unreachable is not an auth problem and must never be reported as one.
  if (!status.ok && !status.expired) {
    console.log(`auth probe inconclusive: ${status.reason}`);
    return;
  }

  const incident = status.expired ? "expired" : "expiring";
  const last = state.notifiedAt ? Date.parse(state.notifiedAt) : 0;
  const due = state.incident !== incident || Date.now() - last > RENOTIFY_MS;

  if (!(await windowOpen())) {
    // Detached: --check is called from a launchd job that must exit, and the
    // window has to outlive it by hours.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  if (!due) {
    console.log(`auth ${incident}, already notified ${hours(Date.now() - last)} ago`);
    return;
  }

  const body = status.expired
    ? [
        `🔴 **devspend** Gmail auth has expired, scans are failing.`,
        `Reconnect (one click, on this Mac): ${START}`,
      ]
    : [
        `🟠 **devspend** Gmail auth expires in ${hours(life.msLeft)}${life.estimated ? " (estimated)" : ""}.`,
        `Reconnect before it breaks: ${START}`,
      ];
  body.push(`_Testing-status clients get 7 days; this link is live for ${hours(WINDOW_MS)} and reopens on the next check._`);

  const r = await discordSend(body.join("\n"));
  await writeState({ incident, notifiedAt: new Date().toISOString() });
  console.log(r.sent ? `posted auth alert (${incident})` : `not posted: ${r.reason}`);
  if (!r.sent) for (const l of body) console.log("  " + l);
}

if (has("--check")) await check();
else await serve({ openBrowser: !has("--serve") });
