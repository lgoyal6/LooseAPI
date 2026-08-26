#!/usr/bin/env node
/**
 * devspend — what your dev tools are actually costing you.
 *
 *   spend                 report to stdout
 *   spend --json          machine-readable (this is what the dashboard reads)
 *   spend --digest        post new alerts to Discord, then exit
 *   spend --import FILE   load a messages dump into ~/.devspend/messages.json
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
import { fetchMessages, loadConfig } from "../lib/spend/gmail.mjs";
import { pollProviders, NO_API } from "../lib/spend/providers.mjs";

const DIR = join(homedir(), ".devspend");
const STATE = join(DIR, "state.json");
const SNAPSHOT = join(DIR, "snapshot.json");

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

async function postDiscord(lines) {
  // Reuse the webhook/DM channel the other automations already use.
  const cfg = await loadConfig();
  const url = cfg.discordWebhook || process.env.DEVSPEND_DISCORD_WEBHOOK;
  if (!url) return { sent: false, reason: "no discordWebhook configured" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n").slice(0, 1900) }),
  });
  return { sent: res.ok, reason: res.ok ? "ok" : `HTTP ${res.status}` };
}

async function main() {
  await mkdir(DIR, { recursive: true });

  if (has("--import")) {
    const src = valueOf("--import");
    if (!src) throw new Error("--import needs a file path");
    await copyFile(src, join(DIR, "messages.json"));
    console.log(`imported ${src} -> ${join(DIR, "messages.json")}`);
    return;
  }

  const config = await loadConfig();
  const { messages, source } = await fetchMessages({ days: 120 });
  const all = extractEvents(messages, SERVICES);

  // Default view is dev spend. Personal-finance and unclassified senders are
  // kept in the snapshot but hidden unless asked for, so a noisy inbox doesn't
  // bury the thing you opened this for.
  const events = has("--all") ? all : all.filter((e) => e.scope === "dev");
  const hidden = all.length - events.length;
  const alerts = findAnomalies(events);
  const providers = await pollProviders(config);
  const monthly = monthlyTotal(events);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source,
    messageCount: messages.length,
    hiddenOutOfScope: hidden,
    monthlyCents: monthly,
    events,
    alerts,
    providers,
    noApi: NO_API,
  };
  await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 2));

  // Diff against last run so a schedule only speaks when something changed.
  const state = await readJson(STATE, { seen: [] });
  const seen = new Set(state.seen);
  const fresh = alerts.filter((a) => !seen.has(alertKey(a)));

  if (has("--json")) {
    console.log(JSON.stringify({ ...snapshot, freshAlerts: fresh }, null, 2));
  } else if (has("--digest")) {
    if (fresh.length === 0) {
      console.log("no new alerts");
    } else {
      const lines = [
        `**devspend** ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}`,
        ...fresh.map((a) => `${a.severity >= 3 ? "🔴" : "🟠"} ${a.message}`),
        `_monthly recurring: ${fmt(monthly)}_`,
      ];
      const r = await postDiscord(lines);
      console.log(r.sent ? `posted ${fresh.length} alert(s)` : `not posted: ${r.reason}`);
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

  console.log(`\nNO API AVAILABLE (receipt email is the only source)`);
  for (const n of s.noApi) console.log(`  ${w(n.name, 34)}${n.reason}`);
  console.log();
}

main().catch((err) => {
  console.error(`devspend: ${err.message}`);
  process.exit(1);
});
