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
  const CONCURRENCY = 12;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const got = await Promise.all(
      batch.map(async (id) => {
        const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
        url.searchParams.set("format", "metadata");
        for (const h of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", h);
        const r = await fetch(url, { headers: auth });
        if (!r.ok) return null;
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
  return out;
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
  const messages = await fetchInbox(auth);
  await mkdir(DIR, { recursive: true });
  await writeFile(CACHE, JSON.stringify({ scannedAt: new Date().toISOString(), messages }));
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
  const labelId = Object.fromEntries((await lr.json()).labels.map((l) => [l.name, l.id]));

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
