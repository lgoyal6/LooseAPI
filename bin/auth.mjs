#!/usr/bin/env node
/**
 * One-shot Gmail OAuth for this tool.
 *
 *   node bin/auth.mjs <client-id> <client-secret>
 *
 * Spins a loopback listener, opens the consent screen, catches the redirect,
 * exchanges the code, and writes the refresh token into ~/.devspend/config.json.
 * Zero dependencies.
 *
 * Scopes requested, and why each is the minimum for its job:
 *
 *   gmail.modify         read messages + add labels. `modify` is a superset of
 *                        `readonly` for everything here, so asking for both
 *                        would be redundant. Notably it does NOT grant delete —
 *                        this tool can never remove your mail.
 *   gmail.settings.basic create the filters that label new mail at delivery.
 *
 * Both are Google "restricted" scopes. That is fine for personal use: an OAuth
 * client left in Testing status serves up to 100 named test users with no
 * verification and no CASA assessment. CASA only applies to published apps.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { CONFIG, consentUrl, exchangeCode, loadCreds, save } from "../lib/spend/oauth.mjs";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString().trim();
}

const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const dryRun = process.argv.includes("--dry-run");
const [argId, argSecret] = args;

// Re-authorising is the common case, not the first run: a refresh token for a
// client left in Testing status expires after seven days, and the client id and
// secret written here on the first run do not change. Reading them back means
// re-auth is one argument-free command and the secret never passes through argv
// or a clipboard again.
const stored = await loadCreds();
const clientId = argId || stored.clientId || "";

// Only consult stdin when a client id was passed, which is the first-run shape
// (`pbpaste | node bin/auth.mjs <id>`). With no arguments this is a re-auth of
// an already-configured client, and reading stdin there would block forever on
// any terminal that leaves it open, such as a launchd job or an agent shell.
let clientSecret = argSecret || "";
if (!clientSecret && argId) clientSecret = await readStdin();
if (!clientSecret) clientSecret = stored.clientSecret || "";

if (clientId && clientSecret && !argId) {
  console.error("using the client id and secret already in ~/.devspend/config.json");
}

if (dryRun) {
  console.error(clientId && clientSecret
    ? "dry run: credentials resolved, the real run would open the consent screen"
    : "dry run: no credentials found");
  process.exit(clientId && clientSecret ? 0 : 1);
}

if (!clientId || !clientSecret) {
  console.error(`usage:\n  node bin/auth.mjs                              reuse the stored client id and secret\n  pbpaste | node bin/auth.mjs <client-id>        secret from clipboard\n  node bin/auth.mjs <client-id> <client-secret>

Get both from Google Cloud Console:
  1. console.cloud.google.com/projectcreate            new project
  2. APIs & Services > Library > Gmail API > Enable
  3. APIs & Services > OAuth consent screen            External, keep it in Testing,
                                                       add your address as a Test user
  4. APIs & Services > Credentials > Create Credentials
       > OAuth client ID > Desktop app                  copy the id and secret`);
  process.exit(1);
}

const state = randomBytes(16).toString("hex");

/** Loopback redirect. Desktop-app clients accept 127.0.0.1 on any port. */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/") return res.writeHead(404).end();

  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (err || url.searchParams.get("state") !== state || !code) {
    res.writeHead(400, { "content-type": "text/html" });
    res.end(`<h2>Authorization failed</h2><p>${err ?? "bad state or missing code"}</p>`);
    console.error(`\nfailed: ${err ?? "state mismatch or no code"}`);
    server.close();
    process.exit(1);
  }

  const port = server.address().port;
  const { ok, body } = await exchangeCode({
    clientId,
    clientSecret,
    code,
    redirectUri: `http://127.0.0.1:${port}`,
  });

  if (!ok || !body.refresh_token) {
    res.writeHead(500, { "content-type": "text/html" });
    res.end("<h2>Token exchange failed</h2><p>Check the terminal.</p>");
    console.error(
      `\ntoken exchange failed: ${JSON.stringify(body).slice(0, 300)}\n` +
        (ok
          ? "No refresh_token came back. That happens when this client was already\n" +
            "authorized — revoke it at myaccount.google.com/permissions and rerun."
          : ""),
    );
    server.close();
    process.exit(1);
  }

  await save({ clientId, clientSecret, refreshToken: body.refresh_token });

  res.writeHead(200, { "content-type": "text/html" });
  res.end("<h2>Connected.</h2><p>You can close this tab and return to the terminal.</p>");
  console.log(`\nrefresh token written to ${CONFIG} (mode 600)`);
  console.log("scopes granted: gmail.modify, gmail.settings.basic");
  console.log("\nnext:");
  console.log("  node bin/spend.mjs                 live scan instead of the seeded dump");
  console.log("  node bin/spend.mjs --label         label the existing backlog");
  console.log("  node -e 'import(\"./lib/mail/filters.mjs\").then(m=>m.installFilters({dryRun:false}))'");
  server.close();
  process.exit(0);
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const auth = consentUrl({ clientId, redirectUri: `http://127.0.0.1:${port}`, state });

  console.log("Opening the consent screen. If it does not open, paste this:\n");
  console.log(auth + "\n");
  console.log("Google will warn the app is unverified — that is expected for a");
  console.log("Testing-status client. Choose Advanced, then continue.\n");
  console.log(`waiting on http://127.0.0.1:${port} …`);
  execFile("open", [auth], () => {});
});
