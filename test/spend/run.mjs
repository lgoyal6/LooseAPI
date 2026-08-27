import { extractEvents, findAnomalies, monthlyTotal, fmt } from "../../lib/spend/costs.mjs";
import { MESSAGES } from "./fixtures.mjs";

const SERVICES = [
  { id: "aws", name: "Amazon Web Services", domains: ["amazonaws.com", "aws.amazon.com"] },
  { id: "cloudflare", name: "Cloudflare", domains: ["cloudflare.com"] },
  { id: "vercel", name: "Vercel", domains: ["vercel.com"] },
  { id: "anthropic", name: "Anthropic", domains: ["anthropic.com"] },
  { id: "railway", name: "Railway", domains: ["railway.app", "railway.com"] },
];

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const events = extractEvents(MESSAGES, SERVICES);

console.log("=== EXTRACTED EVENTS ===");
for (const e of events) {
  const bits = [
    e.date.slice(0, 10),
    e.service.padEnd(22),
    e.kind.padEnd(18),
    e.amountCents != null ? fmt(e.amountCents).padStart(8) : "        ",
    e.creditsRemainingCents != null ? `credits=${fmt(e.creditsRemainingCents)}` : "",
    e.via ? `via ${e.via.split("@").pop()}` : "",
    e.unread ? (e.trashed ? "[unread,trashed]" : "[unread]") : "",
  ];
  console.log("  " + bits.join(" ").trimEnd());
}

console.log("\n=== ASSERTIONS ===");

// The negative control must be rejected outright.
check("marketing email ignored", events.some((e) => e.id === "19fe7d2d8c3dc463"), false);

// Processor attribution: Stripe must not swallow the merchant.
const exa = events.find((e) => e.id === "19fafb31f313c17f");
check("Stripe receipt attributed to Exa Labs", exa?.service, "Exa Labs");
check("Stripe recorded as processor, not merchant", exa?.via, "stripe.com");
check("Exa amount parsed", exa?.amountCents, 2500);

const railway = events.find((e) => e.id === "19fcf6ad8918af17");
check("Stripe receipt attributed to Railway", railway?.service, "Railway");

// First-party sender uses the dictionary.
const cf = events.find((e) => e.id === "1a00a8151f6bb201");
check("Cloudflare via dictionary", cf?.service, "Cloudflare");
check("Cloudflare $0.00 invoice parsed", cf?.amountCents, 0);

// AWS sequence.
const closed = events.find((e) => e.id === "1a01811eec73d278");
check("AWS closure classified", closed?.kind, "account_closed");
check("AWS closure is top severity", closed?.severity, 3);
check("AWS closure seen as unread", closed?.unread, true);
check("AWS closure seen as trashed", closed?.trashed, true);

const c10 = events.find((e) => e.id === "1a0114886d581845");
check("AWS $10 balance parsed", c10?.creditsRemainingCents, 1000);
check("AWS balance classified as credits_low", c10?.kind, "credits_low");

// Anthropic credit grant must not be read as a charge.
const ant = events.find((e) => e.id === "1a0120587125be1d");
check("Anthropic credits_added not a charge", ant?.kind, "credits_added");
check("Anthropic grant is severity 0", ant?.severity, 0);

console.log("\n=== DERIVED ALERTS ===");
const alerts = findAnomalies(events);
for (const a of alerts) console.log(`  [sev ${a.severity}] ${a.kind}: ${a.message}`);

const repeat = alerts.find((a) => a.kind === "repeat_charge");
check("duplicate Exa charge detected", repeat?.service, "Exa Labs");

// The AWS fixture is the founding case: two credit readings, then a closure
// three days later. This assertion used to be "a burndown alert exists", which
// the code satisfied by never checking how old the readings were. It kept
// saying "~1.3 days" every day for the nine days after the account had already
// closed, and the test kept passing, because a projection that ignores its own
// as-of date passes forever.
check(
  "closed account produces no live countdown",
  alerts.find((a) => a.kind === "credit_burndown" && a.service === "Amazon Web Services"),
  undefined,
);

// The projection itself still has to work, so it is exercised on readings that
// have not aged out. Dates are relative to now: a fixture with dates baked in
// is exactly what let the original assertion rot.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const burnEvents = [
  { id: "c1", serviceId: "demo", service: "Demo", date: daysAgo(2), kind: "credits_low", creditsRemainingCents: 4000 },
  { id: "c2", serviceId: "demo", service: "Demo", date: daysAgo(1), kind: "credits_low", creditsRemainingCents: 3000 },
];
const live = findAnomalies(burnEvents).find((a) => a.kind === "credit_burndown");
check("fresh readings still project", live?.service, "Demo");
// $30 left at $10/day, read a day ago: two days from now, not three.
check("runway counts from now, not from the reading", live?.message.includes("~2.0 days"), true);
check("a runway inside three days is urgent", live?.severity, 3);

// Same numbers, read long enough ago that the runway is spent, and no closure
// mail to explain what happened. That is a gap in the record, not a countdown.
const staleEvents = [
  { id: "s1", serviceId: "demo", service: "Demo", date: daysAgo(31), kind: "credits_low", creditsRemainingCents: 4000 },
  { id: "s2", serviceId: "demo", service: "Demo", date: daysAgo(30), kind: "credits_low", creditsRemainingCents: 3000 },
];
const stale = findAnomalies(staleEvents);
check("expired projection is not reported as a countdown",
  stale.find((a) => a.kind === "credit_burndown"), undefined);
check("expired projection is reported as a gap",
  stale.find((a) => a.kind === "credit_stale")?.service, "Demo");

console.log("\n=== TOTALS ===");
console.log(`  monthly recurring (35d): ${fmt(monthlyTotal(events))}`);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
