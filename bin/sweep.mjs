#!/usr/bin/env node
/**
 * Retroactive inbox sweep. Classifies existing mail with lib/mail/rules.mjs and
 * applies the six approved labels.
 *
 *   sweep.mjs                        summary of every bucket, nothing applied
 *   sweep.mjs --show "Jobs/Active"   every subject in one bucket, for review
 *   sweep.mjs --show unmatched       what no rule claimed
 *   sweep.mjs --apply                apply everything
 *   sweep.mjs --apply "Events"       apply one bucket only
 *
 * Dry run is the default and `--apply` is the only path that writes, because
 * this mutates a live mailbox. Results are cached so reviewing bucket by bucket
 * does not re-scan a thousand messages each time.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, accessToken } from "../lib/spend/gmail.mjs";
import { classify, dryRun } from "../lib/mail/rules.mjs";

const DIR = join(homedir(), ".devspend");
const CACHE = join(DIR, "sweep-cache.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const after = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const QUERY = has("--all-mail") ? "-in:spam -in:trash" : "in:inbox";

function headerMap(payload) {
  const out = {};
  for (const h of payload?.headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

async function fetchInbox(auth) {
  const ids = [];
  let pageToken;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", QUERY);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`list failed ${res.status}`);
    const body = await res.json();
    for (const m of body.messages ?? []) ids.push(m.id);
    pageToken = body.nextPageToken;
    process.stderr.write(`\r  listing… ${ids.length}`);
  } while (pageToken);
  process.stderr.write("\n");

  // Metadata only — From/Subject/Date. Bodies are never fetched.
  const out = [];
  const dropped = [];
  const CONCURRENCY = 12;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const got = await Promise.all(
      batch.map(async (id) => {
        const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
        url.searchParams.set("format", "metadata");
        for (const h of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", h);
        const r = await getWithBackoff(url, auth);
        // A dropped message is not a message that does not exist. Returning
        // null here quietly shrank the sweep: a run that half failed looked
        // like a run over fewer messages, and the filing decisions were then
        // made over whatever survived.
        if (!r.ok) {
          dropped.push(`${r.status} ${r.statusText}`);
          return null;
        }
        const m = await r.json();
        const h = headerMap(m.payload);
        return {
          id: m.id,
          threadId: m.threadId,
          from: h.from ?? "",
          subject: h.subject ?? "",
          snippet: m.snippet ?? "",
          labelIds: m.labelIds ?? [],
        };
      }),
    );
    out.push(...got.filter(Boolean));
    process.stderr.write(`\r  fetching metadata… ${out.length}/${ids.length}`);
  }
  process.stderr.write("\n");
  // Said, not swallowed. A sweep that could not read a fifth of the mailbox is
  // filing decisions over a mailbox it did not see, and the counter alone
  // cannot show that: it counts what arrived, so a half-failed run just looks
  // like a smaller one.
  if (dropped.length) {
    const by = {};
    for (const d of dropped) by[d] = (by[d] ?? 0) + 1;
    const why = Object.entries(by).map(([k, n]) => `${n}x ${k}`).join(", ");
    console.error(`  warning: ${dropped.length} of ${ids.length} messages could not be read (${why})`);
  }
  return { messages: out, complete: dropped.length === 0 };
}

// Gmail prices a request in quota units and caps them per minute per user, so
// a mailbox this size fetched flat out spends the minute's budget in seconds
// and then gets 403 for the rest of it. That is not a permission error and
// not a broken credential, which is exactly how it read: the sweep saw 656 of
// 1,331 messages refused, dropped them silently, and then died on the labels
// call with "Cannot read properties of undefined".
//
// Waiting is the entire fix. The quota refills, so a request that failed for
// this reason will succeed shortly, and the only thing to do is stop asking
// for a moment.
async function getWithBackoff(url, auth, attempts = 5) {
  let wait = 2000;
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: auth });
    if (r.ok || i >= attempts) return r;
    // 403 is the quota answer here, 429 the documented one, 5xx transient.
    if (r.status !== 403 && r.status !== 429 && r.status < 500) return r;
    // Jittered, so twelve workers that hit the wall together do not all come
    // back at the same instant and hit it again.
    await new Promise((res) => setTimeout(res, wait + Math.random() * 1000));
    wait = Math.min(wait * 2, 60000);
  }
}

async function loadOrScan(auth) {
  if (!has("--rescan")) {
    try {
      const c = JSON.parse(await readFile(CACHE, "utf8"));
      const ageMin = (Date.now() - new Date(c.scannedAt)) / 60000;
      if (ageMin < 120) {
        console.log(`using cached scan from ${Math.round(ageMin)} min ago (--rescan to refresh)\n`);
        return c.messages;
      }
    } catch {
      /* no cache */
    }
  }
  const { messages, complete } = await fetchInbox(auth);
  // A partial scan is not a smaller mailbox, and caching one poisons every run
  // for the next two hours: the failed sweep cached 718 of 1,331 messages, and
  // the runs after it filed against those 718 while reporting nothing wrong.
  if (complete) {
    await mkdir(DIR, { recursive: true });
    await writeFile(CACHE, JSON.stringify({ scannedAt: new Date().toISOString(), messages }));
  } else {
    console.error("  not caching an incomplete scan");
  }
  return messages;
}

async function main() {
  const cfg = await loadConfig();
  if (!(cfg.clientId && cfg.clientSecret && cfg.refreshToken)) {
    console.error("no Gmail credential — see SETUP.md");
    process.exit(1);
  }
  const auth = { authorization: `Bearer ${await accessToken(cfg)}` };

  const messages = await loadOrScan(auth);
  const { counts, unmatched } = dryRun(messages);

  const lr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers: auth });
  const lb = await lr.json();
  // Gmail answers an error with a JSON body that has no labels in it, so
  // reaching straight for .labels turned every API failure into "Cannot read
  // properties of undefined (reading 'map')", which named neither the call nor
  // the reason. Rate limits and an expired token look identical through that.
  if (!lr.ok || !Array.isArray(lb.labels)) {
    const why = lb?.error?.message ?? `HTTP ${lr.status}`;
    throw new Error(`could not list labels: ${why}`);
  }
  const labelId = Object.fromEntries(lb.labels.map((l) => [l.name, l.id]));

  const ORDER = ["Jobs/Active", "Jobs/Closed", "Events", "Build", "Orders", "Money"];

  // --show <bucket>: full listing for review
  const show = after("--show");
  if (show) {
    const list = show === "unmatched" ? unmatched : (counts[show] ?? []);
    console.log(`${show} — ${list.length} message(s)\n`);
    for (const m of list) {
      const dom = (m.from.match(/@([^>\s]+)/) ?? [, m.from])[1] ?? "";
      const state = m.labelIds.includes("UNREAD") ? " ·unread" : "";
      console.log(`  ${dom.slice(0, 26).padEnd(27)} ${m.subject.slice(0, 74)}${state}`);
    }
    return;
  }

  const applying = has("--apply");
  const only = applying ? after("--apply") : undefined;

  console.log(`${messages.length} messages in scope (${QUERY})\n`);
  for (const label of ORDER) {
    const list = counts[label] ?? [];
    const id = labelId[label];
    const mark = !id ? "NO LABEL" : applying && (!only || only === label) ? "applying" : "dry run";
    console.log(`  ${label.padEnd(13)} ${String(list.length).padStart(4)}   ${mark}`);

    if (!applying || !id || (only && only !== label)) continue;

    let done = 0;
    for (const m of list) {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/modify`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ addLabelIds: [id] }),
        },
      );
      if (r.ok) done++;
      process.stderr.write(`\r    ${label}: ${done}/${list.length}`);
    }
    process.stderr.write("\n");
  }
  console.log(`  ${"unmatched".padEnd(13)} ${String(unmatched.length).padStart(4)}   left alone`);

  const claimed = messages.length - unmatched.length;
  console.log(
    `\ncoverage ${claimed}/${messages.length} = ${Math.round((claimed / messages.length) * 100)}%`,
  );
  if (!applying) console.log("\nnothing was modified. review with --show <bucket>, then --apply");
}

main().catch((e) => {
  console.error(`sweep: ${e.message}`);
  process.exit(1);
});
