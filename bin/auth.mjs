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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

const DIR = join(homedir(), ".devspend");
const CONFIG = join(DIR, "config.json");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString().trim();
}

const [clientId, argSecret] = process.argv.slice(2);
// Prefer stdin: keeps the secret out of argv, so out of `ps` and shell history.
const clientSecret = argSecret || (await readStdin());

if (!clientId || !clientSecret) {
  console.error(`usage:\n  pbpaste | node bin/auth.mjs <client-id>        secret from clipboard\n  node bin/auth.mjs <client-id> <client-secret>

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
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}`,
    }),
  });

  const body = await tokenRes.json();
  if (!tokenRes.ok || !body.refresh_token) {
    res.writeHead(500, { "content-type": "text/html" });
    res.end("<h2>Token exchange failed</h2><p>Check the terminal.</p>");
    console.error(
      `\ntoken exchange failed: ${JSON.stringify(body).slice(0, 300)}\n` +
        (tokenRes.ok
          ? "No refresh_token came back. That happens when this client was already\n" +
            "authorized — revoke it at myaccount.google.com/permissions and rerun."
          : ""),
    );
    server.close();
    process.exit(1);
  }

  // Merge rather than overwrite: config.json may already hold provider tokens.
  await mkdir(DIR, { recursive: true });
  let existing = {};
  try {
    existing = JSON.parse(await readFile(CONFIG, "utf8"));
  } catch {
    /* first run */
  }
  await writeFile(
    CONFIG,
    JSON.stringify({ ...existing, clientId, clientSecret, refreshToken: body.refresh_token }, null, 2),
    { mode: 0o600 },
  );

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
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", `http://127.0.0.1:${port}`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES.join(" "));
  auth.searchParams.set("access_type", "offline"); // required for a refresh token
  auth.searchParams.set("prompt", "consent"); // force one even on re-auth
  auth.searchParams.set("state", state);

  console.log("Opening the consent screen. If it does not open, paste this:\n");
  console.log(auth.toString() + "\n");
  console.log("Google will warn the app is unverified — that is expected for a");
  console.log("Testing-status client. Choose Advanced, then continue.\n");
  console.log(`waiting on http://127.0.0.1:${port} …`);
  execFile("open", [auth.toString()], () => {});
});
