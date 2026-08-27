/**
 * What the coding agents cost, broken down the way someone paying would ask.
 *
 * The data has been there since the day usage.mjs was written: it groups by
 * project, by model and by day, and nothing read any of it. Only the single
 * total was ever shown, which answers "a lot" and no other question.
 *
 * The figure is an equivalent API cost throughout and is labelled that way
 * everywhere it appears. On a flat subscription these tokens cost nothing
 * marginal; the number is what the same work would have cost through the API.
 * It is the right number for deciding whether a subscription is worth keeping,
 * for comparing one project against another, and for noticing a model choice
 * that got expensive. It is the wrong number to put in a budget, and calling it
 * spend would be an overstatement that nobody downstream could detect.
 */

/** Merge the per-tool breakdowns into one, keyed the same way. */
function mergeBy(tools, key) {
  const out = {};
  for (const t of tools) {
    for (const [k, v] of Object.entries(t[key] ?? {})) {
      const acc = (out[k] ??= { cents: 0, messages: 0, input: 0, output: 0 });
      acc.cents += v.cents ?? 0;
      acc.messages += v.messages ?? 0;
      acc.input += (v.input ?? 0) + (v.cacheRead ?? 0) + (v.cacheWrite ?? 0);
      acc.output += v.output ?? 0;
    }
  }
  return out;
}

const rank = (obj, n) =>
  Object.entries(obj)
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, n)
    .map(([name, v]) => ({ name, ...v }));

/**
 * Trend compares the most recent window against the one before it.
 *
 * Two numbers rather than a sparkline, because the question this answers is
 * whether the thing is getting more expensive, and a percentage against the
 * previous equal-length window is the smallest honest way to say so. Windows
 * with no prior data report no trend instead of an infinite increase.
 */
function trend(byDay, window) {
  const days = Object.keys(byDay).sort();
  if (!days.length) return null;
  const recent = days.slice(-window);
  const prior = days.slice(-2 * window, -window);
  if (!prior.length) return null;

  const sum = (list) => list.reduce((n, d) => n + (byDay[d]?.cents ?? 0), 0);
  const now = sum(recent);
  const before = sum(prior);
  if (before === 0) return null;
  return { now, before, pct: Math.round(((now - before) / before) * 100), window };
}

/**
 * report turns a snapshot's usage block into the shape a summary needs.
 *
 * Everything here is derived, nothing is recomputed: the snapshot is written
 * only after a complete scan, so re-deriving totals from session logs would be
 * a second implementation that can disagree with the first.
 */
export function report(usage, { top = 8, window = 7 } = {}) {
  const tools = usage?.tools ?? [];
  const byDay = mergeBy(tools, "byDay");
  const totalCents = tools.reduce((n, t) => n + (t.total?.cents ?? 0), 0);
  const messages = tools.reduce((n, t) => n + (t.total?.messages ?? 0), 0);

  const days = Object.keys(byDay).sort();
  const today = days[days.length - 1];

  return {
    days: usage?.days ?? 0,
    totalCents,
    messages,
    todayCents: byDay[today]?.cents ?? 0,
    today,
    // A per-day average over the days that actually had activity, not over the
    // window: dividing by 30 when eleven of them were weekends understates the
    // rate on a working day, which is the rate anyone is deciding against.
    perActiveDayCents: days.length ? Math.round(totalCents / days.length) : 0,
    activeDays: days.length,
    byTool: tools.map((t) => ({
      name: t.tool, cents: t.total?.cents ?? 0, messages: t.total?.messages ?? 0,
    })).sort((a, b) => b.cents - a.cents),
    byProject: rank(mergeBy(tools, "byProject"), top),
    byModel: rank(mergeBy(tools, "byModel"), top),
    trend: trend(byDay, window),
    caveat:
      "equivalent API cost, not spend: on a flat subscription these tokens cost nothing marginal",
  };
}

export const usd = (cents) =>
  cents >= 100000 ? `$${Math.round(cents / 100).toLocaleString()}`
  : cents >= 100 ? `$${(cents / 100).toFixed(0)}`
  : `$${(cents / 100).toFixed(2)}`;
