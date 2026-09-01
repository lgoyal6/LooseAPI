/**
 * Local coding-agent usage, read from the session logs Claude Code and Codex
 * already write. No API, no credentials — the data is on disk.
 *
 * Every account is read, not just the default one. Both CLIs support more than
 * one login by pointing CODEX_HOME or CLAUDE_CONFIG_DIR at a different home,
 * and this machine runs two Codex accounts that way. Reading only ~/.codex
 * silently dropped an entire account's tokens from every figure downstream,
 * and a total that omits an account is worse than no total, because it looks
 * complete. Usage is tagged by the home it came from so the omission cannot
 * happen quietly again.
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

/**
 * Every home of one agent that keeps state on this machine.
 *
 * Discovered by shape rather than from a list: `.codex` is the default login
 * and `.codex-ish` is a second one, so the rule is the CLI's own directory
 * plus any `-suffix` sibling that actually holds the logs. A third account
 * added later is picked up by existing here, which is the only way this stays
 * true without someone remembering to edit it.
 */
async function homes(name, logs) {
  const root = homedir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name !== `.${name}` && !e.name.startsWith(`.${name}-`)) continue;
    const dir = join(root, e.name, logs);
    try {
      if ((await stat(dir)).isDirectory()) out.push({ account: e.name.slice(1), dir });
    } catch {
      /* a home with no logs yet is not an account with no usage, it is a home */
    }
  }
  return out.sort((a, b) => a.account.localeCompare(b.account));
}

/**
 * The project key both agents have to agree on.
 *
 * Claude Code encodes the working directory into its own directory name with
 * separators flattened to hyphens; Codex records the real path. Producing the
 * same key from both is what lets one project's cost add up across the two
 * agents instead of appearing as two unrelated rows.
 */
function projectKey(cwd) {
  if (!cwd) return "(home)";
  const root = homedir();
  const rel = cwd === root ? "" : cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : cwd.replace(/^\//, "");
  return rel ? rel.split("/").join("-") : "(home)";
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
  const byDay = {};
  const byModel = {};
  const byProject = {};
  const byAccount = {};
  const total = blank();
  let count = 0;

  for (const { account, dir } of await homes("claude", "projects")) {
    const files = await recentFiles(dir, days);
    count += files.length;
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
        (byAccount[account] ??= blank()) && bump(byAccount[account], u, model);
        bump(total, u, model);
      }
    }
  }
  return { tool: "Claude Code", files: count, total, byDay, byModel, byProject, byAccount };
}

/**
 * Codex: `payload.info.total_token_usage` is cumulative within a session, so
 * the last record per file is the session total. Summing every record would
 * multiply usage by the number of turns.
 *
 * That cumulative total is also why the model and project breakdowns are per
 * session rather than per turn. A session can hand work to a review model
 * partway through, and the running total cannot be split back apart; the whole
 * session is therefore booked to the model it started under, which is the one
 * that did the work. Inventing a split from numbers that do not carry one
 * would be a more precise-looking answer and a less true one.
 */
export async function codexUsage({ days = 30 } = {}) {
  const byDay = {};
  const byModel = {};
  const byProject = {};
  const byAccount = {};
  const total = blank();
  let count = 0;

  for (const { account, dir } of await homes("codex", "sessions")) {
    const files = await recentFiles(dir, days);
    count += files.length;
    for (const f of files) {
      let text;
      try {
        text = await readFile(f, "utf8");
      } catch {
        continue;
      }
      let last = null;
      let day = "";
      let model = "";
      let cwd = "";
      for (const line of text.split("\n")) {
        if (!line) continue;
        const usage = line.includes("total_token_usage");
        // A rollout line is large and most of them carry neither field, so the
        // cheap substring test comes before the parse.
        if (!usage && !line.includes('"cwd"')) continue;
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
          continue;
        }
        // The first turn_context holds the model the session runs under; later
        // ones can name a review model the session delegated to.
        if (!cwd) cwd = d?.payload?.cwd ?? "";
        if (!model) model = d?.payload?.model ?? "";
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
      const named = model || "unknown";
      const project = projectKey(cwd);
      if (key) (byDay[key] ??= blank()) && bump(byDay[key], norm, named);
      (byModel[named] ??= blank()) && bump(byModel[named], norm, named);
      (byProject[project] ??= blank()) && bump(byProject[project], norm, named);
      (byAccount[account] ??= blank()) && bump(byAccount[account], norm, named);
      bump(total, norm, named);
    }
  }
  return { tool: "Codex", files: count, total, byDay, byModel, byProject, byAccount };
}

export async function allUsage({ days = 30 } = {}) {
  const [claude, codex] = await Promise.all([claudeUsage({ days }), codexUsage({ days })]);
  return { days, tools: [claude, codex] };
}

export const tokens = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
