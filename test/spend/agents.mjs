import { report, usd } from "../../lib/spend/agents.mjs";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const day = (cents) => ({ cents, messages: 1, input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });

// Two tools, overlapping projects and models, so the merge is doing something.
const usage = {
  days: 30,
  tools: [
    {
      tool: "Claude Code",
      total: { cents: 3000, messages: 30 },
      byDay: { "2026-08-01": day(1000), "2026-08-02": day(1000), "2026-08-03": day(1000) },
      byProject: { amac: day(2000), looseapi: day(1000) },
      byModel: { "claude-opus-5": day(3000) },
      byAccount: { "claude-gmi": day(3000) },
    },
    {
      tool: "Codex",
      total: { cents: 1000, messages: 10 },
      byDay: { "2026-08-03": day(1000) },
      byProject: { amac: day(1000) },
      byModel: { "gpt-5": day(1000) },
      byAccount: { codex: day(600), "codex-ish": day(400) },
    },
  ],
};

const r = report(usage, { top: 5, window: 1 });

check("totals add across tools", r.totalCents, 4000);
check("messages add across tools", r.messages, 40);
check("tools rank by cost", r.byTool.map((t) => t.name), ["Claude Code", "Codex"]);

// The merge has to add the same project across tools, not shadow one with the
// other: amac is 2000 from Claude and 1000 from Codex.
check("projects merge across tools", r.byProject[0], { name: "amac", cents: 3000, messages: 2, input: 20, output: 10 });
check("models stay separate", r.byModel.map((m) => m.name), ["claude-opus-5", "gpt-5"]);

// Every account appears, smallest included. A `top` cut-off here would hide
// the account nobody is watching, which is the one worth surfacing.
check("accounts rank by cost, none dropped", r.byAccount.map((a) => a.name), ["claude-gmi", "codex", "codex-ish"]);

// Today is the newest day present, and both tools' spend on it counts.
check("today is the newest day", r.today, "2026-08-03");
check("today adds both tools", r.todayCents, 2000);

// Divided by active days, not by the window. Dividing 30 days of cost by 30
// when eleven of them were weekends understates the rate on a working day,
// which is the rate anyone is deciding against.
check("per active day uses active days", r.activeDays, 3);
check("per active day is the real rate", r.perActiveDayCents, 1333);

// One day against the one before it: 2000 vs 1000.
check("trend compares equal windows", r.trend, { now: 2000, before: 1000, pct: 100, window: 1 });

// No prior window means no trend, rather than an infinite increase.
const young = report({ days: 30, tools: [{ tool: "x", total: { cents: 100 }, byDay: { "2026-08-01": day(100) } }] }, { window: 7 });
check("a first window reports no trend", young.trend, null);

// And a prior window of zero is the same problem wearing a different hat.
const fromZero = report({
  days: 30,
  tools: [{ tool: "x", total: { cents: 100 }, byDay: { "2026-08-01": day(0), "2026-08-02": day(100) } }],
}, { window: 1 });
check("growth from zero reports no trend", fromZero.trend, null);

// The label travels with the number wherever it goes.
check("the caveat is always present", r.caveat.includes("not spend"), true);

check("usd is readable at every size", [usd(0), usd(7), usd(2500), usd(1915091)], ["$0.00", "$0.07", "$25", "$19,151"]);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
