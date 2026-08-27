#!/usr/bin/env node
/**
 * devspend — what your dev tools are actually costing you.
 *
 *   spend                 report to stdout
 *   spend --json          machine-readable (this is what the dashboard reads)
 *   spend --digest        post new alerts to Discord, then exit
 *   spend --import FILE   load a messages dump into ~/.devspend/messages.json
 *   spend --ingest PATH   add forwarded mail: an .eml, an mbox, or a directory
 *
 * Alerting is state-diffed: only alerts not seen on a previous run are pushed,
 * matching how `amac health` behaves. That keeps a daily schedule quiet until
 * something actually changes.
 */
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SERVICES } from "../lib/spend/services.mjs";
import { extractEvents, findAnomalies, monthlyTotal, fmt } from "../lib/spend/costs.mjs";
import { fetchMessages, loadConfig, applyLabels } from "../lib/spend/gmail.mjs";
import { pollProviders, NO_API } from "../lib/spend/providers.mjs";
import { send as discordSend, pushable } from "../lib/spend/notify.mjs";
import { allUsage, tokens } from "../lib/spend/usage.mjs";

const DIR = join(homedir(), ".devspend");
const STATE = join(DIR, "state.json");
const SNAPSHOT = join(DIR, "snapshot.json");
const LEDGER = join(DIR, "ledger.json");
const MESSAGES = join(DIR, "messages.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}

function alertKey(a) {
  return `${a.kind}:${a.service}:${(a.evidence || []).join(",")}`;
}

async function main() {
  await mkdir(DIR, { recursive: true });

  if (has("--ingest")) {
    const src = valueOf("--ingest");
    if (!src) throw new Error("--ingest needs a file or directory");
    const added = await ingestForwarded(src);
    console.log(`ingested ${added} message(s) from ${src}`);
  }

  if (has("--import")) {
    const src = valueOf("--import");
    if (!src) throw new Error("--import needs a file path");
    await copyFile(src, MESSAGES);
    console.log(`imported ${src} -> ${MESSAGES}`);
    return;
  }

  const config = await loadConfig();
  const { messages, source } = await fetchMessages({ days: 120 });

  // Cumulative ledger. A rebuilt-from-current-mail snapshot silently loses
  // history the moment a message is deleted — and billing mail is exactly the
  // mail people delete. Once an event is seen it is kept, keyed by message id,
  // so the record outlives the inbox it came from.
  const ledger = await readJson(LEDGER, { events: {} });
  const scanned = extractEvents(messages, SERVICES);
  for (const e of scanned) {
    ledger.events[e.id] = { ...(ledger.events[e.id] || {}), ...e, firstSeen: ledger.events[e.id]?.firstSeen ?? new Date().toISOString() };
  }
  ledger.updatedAt = new Date().toISOString();
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));

  const scannedIds = new Set(scanned.map((e) => e.id));
  const all = Object.values(ledger.events)
    // Flag anything the ledger remembers that the mailbox no longer returns.
    .map((e) => ({ ...e, missingFromMailbox: !scannedIds.has(e.id) }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Default view is dev spend. Personal-finance and unclassified senders are
  // kept in the snapshot but hidden unless asked for, so a noisy inbox doesn't
  // bury the thing you opened this for.
  // Dev tools and consumer subscriptions are both "recurring expenditure";
  // only bank, utility and insurance mail is out of scope by default.
  const events = has("--all")
    ? all
    : all.filter((e) => e.scope === "dev" || e.scope === "consumer");
  const hidden = all.length - events.length;
  const alerts = findAnomalies(events);
  const providers = await pollProviders(config);
  const usage = await allUsage({ days: 30 });
  const monthly = monthlyTotal(events);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source,
    messageCount: messages.length,
    ledgerSize: Object.keys(ledger.events).length,
    recoveredFromLedger: all.filter((e) => e.missingFromMailbox).length,
    hiddenOutOfScope: hidden,
    monthlyCents: monthly,
    events,
    alerts,
    providers,
    usage,
    noApi: NO_API,
  };
  await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 2));

  // Diff against last run so a schedule only speaks when something changed.
  const state = await readJson(STATE, { seen: [] });
  const seen = new Set(state.seen);
  const fresh = alerts.filter((a) => !seen.has(alertKey(a)));

  if (has("--label")) {
    const r = await applyLabels(all);
    console.log(
      r.reason
        ? `labelling skipped: ${r.reason}`
        : `labelled ${r.labelled} message(s), skipped ${r.skipped}`,
    );
  }

  if (has("--json")) {
    console.log(JSON.stringify({ ...snapshot, freshAlerts: fresh }, null, 2));
  } else if (has("--digest")) {
    // Only alerts that are both new AND still actionable get pushed; the rest
    // stay on the dashboard.
    const worth = pushable(fresh);
    if (worth.length === 0) {
      console.log(
        fresh.length
          ? `${fresh.length} new alert(s), none time-critical — left for the dashboard`
          : "no new alerts",
      );
    } else {
      const lines = [
        `**spend** ${worth.length} alert${worth.length === 1 ? "" : "s"}`,
        ...worth.map((a) => `${a.severity >= 3 ? "🔴" : "🟠"} ${a.message}`),
        `_monthly recurring: ${fmt(monthly)}_`,
      ];
      const r = await discordSend(lines.join("\n"));
      console.log(r.sent ? `posted ${worth.length} alert(s)` : `not posted: ${r.reason}`);
      if (!r.sent) for (const l of lines) console.log("  " + l);
    }
  } else {
    render(snapshot, fresh);
  }

  await writeFile(
    STATE,
    JSON.stringify({ seen: alerts.map(alertKey), lastRun: snapshot.generatedAt }, null, 2),
  );
}

function render(s, fresh) {
  const w = (str, n) => String(str).padEnd(n);
  console.log(`\ndevspend  ${s.generatedAt.slice(0, 16).replace("T", " ")}  (source: ${s.source}, ${s.messageCount} messages scanned${s.hiddenOutOfScope ? `, ${s.hiddenOutOfScope} out of scope` : ""})\n`);
  if (s.recoveredFromLedger)
    console.log(`  ${s.recoveredFromLedger} event(s) retained from the ledger but no longer in the mailbox\n`);

  console.log(`MONTHLY RECURRING   ${fmt(s.monthlyCents)}`);

  if (s.alerts.length) {
    console.log(`\nALERTS (${s.alerts.length}${fresh.length ? `, ${fresh.length} new` : ""})`);
    for (const a of s.alerts) {
      const isNew = fresh.some((f) => alertKey(f) === alertKey(a));
      console.log(`  ${a.severity >= 3 ? "!!" : " !"} ${a.message}${isNew ? "   <- new" : ""}`);
    }
  } else {
    console.log("\nALERTS  none");
  }

  const charges = s.events.filter((e) => e.kind === "charge");
  if (charges.length) {
    console.log(`\nCHARGES`);
    console.log(`  ${w("DATE", 12)}${w("SERVICE", 24)}${w("AMOUNT", 10)}NOTE`);
    for (const e of charges) {
      const note = [e.via ? `via ${e.via}` : "", e.unread ? "unread" : ""].filter(Boolean).join(", ");
      console.log(`  ${w(e.date.slice(0, 10), 12)}${w(e.service, 24)}${w(fmt(e.amountCents), 10)}${note}`);
    }
  }

  const other = s.events.filter((e) => e.kind !== "charge");
  if (other.length) {
    console.log(`\nCREDIT & ACCOUNT EVENTS`);
    console.log(`  ${w("DATE", 12)}${w("SERVICE", 24)}${w("EVENT", 20)}BALANCE`);
    for (const e of other) {
      console.log(
        `  ${w(e.date.slice(0, 10), 12)}${w(e.service, 24)}${w(e.kind, 20)}${fmt(e.creditsRemainingCents)}`,
      );
    }
  }

  console.log(`\nLIVE PROVIDER BALANCES`);
  for (const p of s.providers) {
    const detail =
      p.status === "ok"
        ? `${fmt(p.cents)}${p.note ? ` (${p.note})` : ""}`
        : p.status === "error"
          ? `error: ${p.error}`
          : `skipped — ${p.note}`;
    console.log(`  ${w(p.name, 24)}${detail}`);
  }

  if (s.usage) {
    console.log(`\nCODING AGENT USAGE (last ${s.usage.days} days, local session logs)`);
    for (const t of s.usage.tools) {
      if (!t.total.messages) continue;
      console.log(
        `  ${w(t.tool, 16)}${w(tokens(t.total.input + t.total.output + t.total.cacheRead), 12)}` +
          `equiv API cost ${fmt(t.total.cents)}`,
      );
    }
    console.log(`  (subscriptions do not bill per token — "equivalent" is what the API would charge)`);
  }

  console.log(`\nNO API AVAILABLE (receipt email is the only source)`);
  for (const n of s.noApi) console.log(`  ${w(n.name, 34)}${n.reason}`);
  console.log();
}

main().catch((err) => {
  console.error(`devspend: ${err.message}`);
  process.exit(1);
});

/**
 * Ingest mail that arrived by forwarding.
 *
 * Merged into the same messages.json the mailbox scan writes, keyed by id, so a
 * mailbox and a forwarding address can both feed the same ledger and a message
 * that arrives twice is one message. Re-ingesting the same file is therefore
 * free, which matters because the obvious way to run this is a cron over a
 * maildir that never empties.
 */
async function ingestForwarded(src) {
  const { parseAll } = await import("../lib/mail/inbound.mjs");
  const { readdir, stat } = await import("node:fs/promises");

  const files = [];
  if ((await stat(src)).isDirectory()) {
    for (const name of await readdir(src)) {
      if (/\.(eml|mbox|txt)$/i.test(name) || !name.includes(".")) {
        files.push(join(src, name));
      }
    }
  } else {
    files.push(src);
  }

  const incoming = [];
  for (const f of files) {
    try {
      incoming.push(...parseAll(await readFile(f, "utf8")));
    } catch {
      // One unreadable file must not lose the rest of the batch.
    }
  }

  const existing = await readJson(MESSAGES, []);
  const byId = new Map(existing.map((m) => [m.id, m]));
  let added = 0;
  for (const m of incoming) {
    if (byId.has(m.id)) continue;
    byId.set(m.id, m);
    added++;
  }

  const merged = [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  await mkdir(DIR, { recursive: true });
  await writeFile(MESSAGES, JSON.stringify(merged, null, 2));
  return added;
}
