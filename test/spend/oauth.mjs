/**
 * The two judgements the reconnect alert rests on.
 *
 * Both fail silently if they are wrong. A bad expiry estimate means no warning
 * and a week of dead scans, which is the outage this was written for. Calling a
 * network blip "expired" means a Discord ping telling you to re-authorise a
 * token that is fine, and a few of those and the real one gets ignored.
 *
 * Same fixture-HOME trick as usage.mjs: oauth.mjs resolves ~/.devspend at
 * import time, so $HOME has to be pointed at a temp tree before the import.
 */
import { mkdir, mkdtemp, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "oauth-"));
process.env.HOME = root;
await mkdir(join(root, ".devspend"), { recursive: true });
const CONFIG = join(root, ".devspend", "config.json");

const { tokenLife, probe, TESTING_TTL_MS } = await import("../../lib/spend/oauth.mjs");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const writeConfig = (obj) => writeFile(CONFIG, JSON.stringify(obj), { mode: 0o600 });
const hoursLeft = (life) => Math.round(life.msLeft / 3600_000);

// --- expiry math ------------------------------------------------------------

const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
await writeConfig({ authorizedAt: twoDaysAgo });
let life = await tokenLife({ authorizedAt: twoDaysAgo });
check("authorizedAt drives the estimate: 5 days left of 7", hoursLeft(life), 5 * 24);
check("and it is not flagged as guessed", life.estimated, false);

// The config live today was written before authorizedAt existed, so the mtime
// fallback is the path that actually runs on the first upgrade.
const sixDaysAgo = new Date(Date.now() - 6 * 86400000);
await writeConfig({ clientId: "x" });
await utimes(CONFIG, sixDaysAgo, sixDaysAgo);
life = await tokenLife({ clientId: "x" });
check("mtime fallback when authorizedAt is absent: 1 day left", hoursLeft(life), 24);
check("and it says so", life.estimated, true);

check("an already-dead token reports negative time", (await tokenLife({
  authorizedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
})).msLeft < 0, true);

check("the window Google actually gives a Testing client", TESTING_TTL_MS, 7 * 86400000);

// --- expired vs unreachable -------------------------------------------------

const creds = { clientId: "a", clientSecret: "b", refreshToken: "c" };
const withFetch = async (impl) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await probe(creds);
  } finally {
    globalThis.fetch = real;
  }
};

let r = await withFetch(async () => new Response("{}", { status: 200 }));
check("a live token is ok", [r.ok, r.expired], [true, false]);

r = await withFetch(async () => new Response(
  JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
  { status: 400 },
));
check("invalid_grant is the one answer that needs a human", [r.ok, r.expired], [false, true]);

r = await withFetch(async () => { throw new TypeError("fetch failed"); });
check("a dead network is not a dead token", [r.ok, r.expired], [false, false]);

// Google 5xxs during an incident. Retrying is right; telling someone to go and
// re-consent is not.
r = await withFetch(async () => new Response("upstream oops", { status: 503 }));
check("a 503 is not a dead token either", [r.ok, r.expired], [false, false]);

r = await probe({ clientId: "a" });
check("missing credentials count as needing consent", [r.ok, r.expired], [false, true]);

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
