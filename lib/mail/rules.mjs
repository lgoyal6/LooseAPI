/**
 * Inbox classification rules.
 *
 * Derived from a 30-day sample of a real inbox, not from what the spend parser
 * happens to emit. Ordered: the first rule that matches wins, so the
 * deadline-bearing buckets are tested before the archival ones.
 *
 * Deliberately no rule for verification codes. They are urgent for ten minutes
 * and worthless afterwards, so a label would be pure churn.
 */

/** first match wins */
export const RULES = [
  {
    label: "Jobs/Active",
    why: "something to do, with a deadline",
    test: ({ from, subject }) =>
      /hackerrank|codesignal|karat|hackerearth|codility/i.test(from) ||
      /\b(assessment|online assessment|\bOA\b|technical test|coding challenge|interview|schedule.*(interview|call)|take.?home)\b/i.test(subject) ||
      /invitation to complete|next step in your .* application|take the next step/i.test(subject),
  },
  {
    label: "Jobs/Closed",
    why: "applied or rejected — nothing to do",
    test: ({ from, subject }) =>
      /greenhouse|lever\.co|myworkday|workday|paycomonline|jobvite|smartrecruiters|icims|ashbyhq|experis|taleo/i.test(from) ||
      /thank you for (applying|your interest)|application (received|next steps|status)|unable to move forward|not (be )?moving forward|we regret/i.test(subject) ||
      /candidate profile|career fair/i.test(subject),
  },
  {
    label: "Events",
    why: "date-bound: hackathons, meetups, calls",
    test: ({ from, subject }) =>
      /luma-mail|lu\.ma|eventbrite|meetup\.com|hopin|getvfairs|calendar\.google/i.test(from) ||
      /\b(hackathon|meetup|networking|you'?re invited|registration (confirmed|successful)|rsvp|appointment booked|demo night|hack night)\b/i.test(subject),
  },
  {
    label: "Orders",
    why: "purchases, shipping, payment problems",
    test: ({ from, subject }) =>
      /shopifyemail|tremendous|shipment|delivery|payu\./i.test(from) ||
      /\border (confirmed|summary|#|placed)|on its way|has shipped|tracking number|transaction (failed|successful)|your purchase\b/i.test(subject),
  },
  {
    label: "Money",
    why: "bills, subscriptions, credits, renewals",
    test: ({ from, subject, snippet }) =>
      /amazonaws|billing|invoice|yardi|sdge|notify\.cloudflare/i.test(from) ||
      /\b(invoice|billing statement|subscription|credits? remaining|free (plan|trial) (has )?ended|payment (failed|declined)|renew(s|al)?)\b/i.test(subject) ||
      /credits? remaining|has been closed because/i.test(snippet ?? ""),
  },
  {
    label: "Build",
    why: "dev services — high volume, low urgency",
    test: ({ from, subject }) =>
      /github\.com|gitlab|vercel\.com|netlify|pypi\.org|npmjs|aiven\.io|render\.com|railway|supabase|neon\.tech|circleci|sentry/i.test(from) ||
      /\b(deployed|deployment|pull request|\bPR #\d+|merged|build (failed|passed)|oauth application)\b/i.test(subject),
  },
];

/** @returns {{label:string, why:string}|null} */
export function classify(msg) {
  for (const r of RULES) {
    try {
      if (r.test(msg)) return { label: r.label, why: r.why };
    } catch {
      /* a bad rule must not break the sweep */
    }
  }
  return null;
}

/** Counts per label plus the unmatched remainder, for a dry run. */
export function dryRun(messages) {
  const counts = {};
  const unmatched = [];
  for (const m of messages) {
    const hit = classify(m);
    if (!hit) {
      unmatched.push(m);
      continue;
    }
    (counts[hit.label] ??= []).push(m);
  }
  return { counts, unmatched };
}
