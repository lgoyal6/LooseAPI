/**
 * Multi-account discovery, against a fixture machine.
 *
 * This is the regression that matters: reading only ~/.codex dropped a whole
 * login out of every figure downstream, and nothing about the output looked
 * wrong. os.homedir() reads $HOME on POSIX, so pointing it at a fixture tree
 * exercises the real discovery path rather than a stubbed one.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = process.env.HOME;
const root = await mkdtemp(join(tmpdir(), "usage-"));
process.env.HOME = root;

const { claudeUsage, codexUsage } = await import("../../lib/spend/usage.mjs");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

/** One Codex session: a turn context, then its cumulative token total. */
async function codexSession(home, { cwd, model, input, output }) {
  const dir = join(root, home, "sessions", "2026", "08", "30");
  await mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: "2026-08-30T10:00:00Z", type: "turn_context", payload: { cwd, model } }),
    JSON.stringify({
      timestamp: "2026-08-30T10:01:00Z",
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output } } },
    }),
  ];
  await writeFile(join(dir, `rollout-${home}-${cwd.replace(/\W/g, "")}.jsonl`), lines.join("\n"));
}

async function claudeSession(home, { project, model, input, output }) {
  const dir = join(root, home, "projects", project);
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({
    timestamp: "2026-08-30T10:00:00Z",
    message: { model, usage: { input_tokens: input, output_tokens: output } },
  });
  await writeFile(join(dir, "session.jsonl"), line);
}

await codexSession(".codex", { cwd: `${root}/amac`, model: "gpt-5.6", input: 1_000_000, output: 0 });
await codexSession(".codex-ish", { cwd: `${root}/mint`, model: "gpt-5.6", input: 2_000_000, output: 0 });
// A directory that looks like a home but holds no session log is not an
// account with no usage; it is not an account.
await mkdir(join(root, ".codex-empty"), { recursive: true });
await claudeSession(".claude", { project: `-Users-me-amac`, model: "claude-opus-5", input: 1_000_000, output: 0 });
await claudeSession(".claude-lgoyal", { project: `-Users-me-mint`, model: "claude-opus-5", input: 1_000_000, output: 0 });

const codex = await codexUsage({ days: 30 });
const claude = await claudeUsage({ days: 30 });

// The whole point: a second login is read, and named, rather than dropped.
check("every codex home is read", Object.keys(codex.byAccount).sort(), ["codex", "codex-ish"]);
check("a home with no logs is not an account", codex.byAccount["codex-empty"], undefined);
check("the second account's tokens are counted", codex.byAccount["codex-ish"].input, 2_000_000);
check("the total spans both accounts", codex.total.input, 3_000_000);
check("every claude home is read", Object.keys(claude.byAccount).sort(), ["claude", "claude-lgoyal"]);

// Codex used to report no project and no model at all, so every breakdown on
// the dashboard was silently Claude-only.
check("codex reports projects", Object.keys(codex.byProject).sort(), ["amac", "mint"]);
check("codex reports models", Object.keys(codex.byModel), ["gpt-5.6"]);

// Both agents have to key a project the same way, or one repo shows up as two
// unrelated rows once the tools are merged. Claude encodes the path into a
// directory name; Codex records the real path and has to arrive at the same
// key, including for a session run straight out of the home directory.
await codexSession(".codex", { cwd: root, model: "gpt-5.6", input: 500_000, output: 0 });
const rerun = await codexUsage({ days: 30 });
check("a session in the home directory keys as (home)", Boolean(rerun.byProject["(home)"]), true);
check("a nested path flattens the way Claude's does", Object.keys(rerun.byProject).sort(), ["(home)", "amac", "mint"]);

process.env.HOME = real;
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
