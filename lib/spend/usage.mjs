/**
 * Local coding-agent usage, read from the session logs Claude Code and Codex
 * already write. No API, no credentials — the data is on disk.
 *
 * Two honest limits worth stating up front:
 *
 * 1. This is *token consumption*, not the 5-hour rolling limit. That limit is
 *    server-side state with no local file and no endpoint; the CLI shows it in
 *    its own UI and nothing exposes it as a number.
 * 2. On a flat subscription these tokens cost nothing marginal. The dollar
 *    figure below is therefore labelled "equivalent API cost" everywhere — what
 *    the same work would have cost through the API — never presented as spend.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Per-MTok list prices, for the equivalent-cost figure only. */
const PRICES = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
const DEFAULT_PRICE = { in: 5, out: 25 };

function priceFor(model = "") {
  const key = Object.keys(PRICES).find((k) => model.includes(k));
  return key ? PRICES[key] : DEFAULT_PRICE;
}

/** Cache reads are billed at ~0.1x input, cache writes at ~1.25x. */
function centsFor(model, u) {
  const p = priceFor(model);
  const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 +
    (u.cache_read_input_tokens ?? 0) * 0.1;
  const outTok = u.output_tokens ?? 0;
  return Math.round(((inTok / 1e6) * p.in + (outTok / 1e6) * p.out) * 100);
}

async function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out, depth + 1);
    else if (e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

async function recentFiles(root, days) {
  const cutoff = Date.now() - days * 86400000;
  const files = await walk(root);
  const keep = [];
  for (const f of files) {
    try {
      if ((await stat(f)).mtimeMs >= cutoff) keep.push(f);
    } catch {
      /* vanished mid-walk */
    }
  }
  return keep;
}

function blank() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cents: 0, messages: 0 };
}

function bump(acc, u, model) {
  acc.input += u.input_tokens ?? 0;
  acc.output += u.output_tokens ?? 0;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;
  acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
  acc.cents += centsFor(model, u);
  acc.messages += 1;
}

/** Claude Code: one usage record per assistant message. */
export async function claudeUsage({ days = 30 } = {}) {
  const root = join(homedir(), ".claude", "projects");
  const files = await recentFiles(root, days);
  const byDay = {};
  const byModel = {};
  const byProject = {};
  const total = blank();

  for (const f of files) {
    // Directory name encodes the project path, e.g. -Users-lakshgoyal-looseapi
    const project = f.split("/").slice(-2, -1)[0]?.replace(/^-Users-[^-]+-?/, "") || "(home)";
    let text;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line || !line.includes('"usage"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const u = d?.message?.usage;
      if (!u) continue;
      const model = d?.message?.model ?? "unknown";
      const day = (d.timestamp ?? "").slice(0, 10);
      if (day) (byDay[day] ??= blank()) && bump(byDay[day], u, model);
      (byModel[model] ??= blank()) && bump(byModel[model], u, model);
      (byProject[project] ??= blank()) && bump(byProject[project], u, model);
      bump(total, u, model);
    }
  }
  return { tool: "Claude Code", files: files.length, total, byDay, byModel, byProject };
}

/**
 * Codex: `payload.info.total_token_usage` is cumulative within a session, so
 * the last record per file is the session total. Summing every record would
 * multiply usage by the number of turns.
 */
export async function codexUsage({ days = 30 } = {}) {
  const root = join(homedir(), ".codex", "sessions");
  const files = await recentFiles(root, days);
  const byDay = {};
  const total = blank();

  for (const f of files) {
    let text;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    let last = null;
    let day = "";
    for (const line of text.split("\n")) {
      if (!line || !line.includes("total_token_usage")) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const u = d?.payload?.info?.total_token_usage;
      if (u) {
        last = u;
        day = (d.timestamp ?? "").slice(0, 10) || day;
      }
    }
    if (!last) continue;
    const norm = {
      input_tokens: last.input_tokens ?? 0,
      output_tokens: last.output_tokens ?? 0,
      cache_read_input_tokens: last.cached_input_tokens ?? 0,
      cache_creation_input_tokens: last.cache_write_input_tokens ?? 0,
    };
    // Fall back to the path date when the record carries no timestamp.
    const fromPath = f.match(/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
    const key = day || (fromPath ? `${fromPath[1]}-${fromPath[2]}-${fromPath[3]}` : "");
    if (key) (byDay[key] ??= blank()) && bump(byDay[key], norm, "unknown");
    bump(total, norm, "unknown");
  }
  return { tool: "Codex", files: files.length, total, byDay, byModel: {}, byProject: {} };
}

export async function allUsage({ days = 30 } = {}) {
  const [claude, codex] = await Promise.all([claudeUsage({ days }), codexUsage({ days })]);
  return { days, tools: [claude, codex] };
}

export const tokens = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
