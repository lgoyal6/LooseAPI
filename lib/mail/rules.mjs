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

/**
 * Additional labels applied on top of the primary one. Money stays the catch-all
 * for anything financial — bank statements, utilities, travel, dev tools alike —
 * and Money/Dev marks the dev-tool subset so it can be read on its own without
 * splitting the parent.
 *
 * The dev-sender list is not written twice: it comes from the spend dictionary
 * in lib/spend/services.mjs, so adding a provider there covers both surfaces.
 */
export const SECONDARY = [
  {
    label: "Money/Dev",
    when: (msg, primary, services) => {
      if (primary !== "Money") return false;
      const dom = (msg.from.match(/@([^>\s]+)/) ?? [, ""])[1].toLowerCase();
      const devCats = new Set(["hosting", "cloud", "ai", "data", "dev-tool"]);
      const hit = services.some(
        (sv) =>
          devCats.has(sv.category) &&
          sv.domains.some((d) => dom === d || dom.endsWith("." + d)),
      );
      if (hit) return true;
      // Processor mail names the merchant in the subject, not the sender, so a
      // Stripe receipt for Railway would otherwise be missed.
      // Two shapes in the wild: "receipt from X #123" and "Your X receipt [#123]".
      const subj = msg.subject ?? "";
      const name =
        /(?:receipt|invoice) from\s+(.+?)\s*(?:[\[(]?#|$)/i.exec(subj) ||
        /your\s+(.+?)\s+(?:receipt|invoice)\b/i.exec(subj);
      if (!name) return false;
      const merchant = name[1].toLowerCase();
      return services.some(
        (sv) => devCats.has(sv.category) && merchant.includes(sv.name.toLowerCase().split(" ")[0]),
      );
    },
  },
];

/** first match wins */
export const RULES = [
  {
    label: "Jobs/Active",
    why: "something to do, with a deadline",
    test: ({ from, subject }) =>
      /hackerrank|codesignal|karat|hackerearth|codility|hirevue|coderpad/i.test(from) ||
      /\b(assessment|online assessment|\bOA\b|technical test|coding challenge|interview|schedule.*(interview|call)|take.?home)\b/i.test(subject) ||
      /invitation to complete|next step in your .* application|take the next step/i.test(subject),
  },
  {
    label: "Jobs/Closed",
    why: "applied or rejected — nothing to do",
    test: ({ from, subject }) =>
      /greenhouse|lever\.co|myworkday|workday|paycomonline|jobvite|smartrecruiters|icims|ashbyhq|experis|taleo|recruitment\.|careers\.|ycombinator|projectbasta|mlh\.io|eprivatemail|successfactors|avature/i.test(from) ||
      /thank you for (applying|your interest)|application (received|next steps|status)|unable to move forward|not (be )?moving forward|we regret/i.test(subject) ||
      /candidate profile|career fair|update on your application|application (is )?(under|in) review|resume scored|fellowship application/i.test(subject),
  },
  {
    label: "Events",
    why: "date-bound: hackathons, meetups, calls",
    test: ({ from, subject }) =>
      /luma-mail|lu\.ma|eventbrite|meetup\.com|hopin|getvfairs|calendar\.google|zcal\.co|calendly/i.test(from) ||
      /\b(hackathon|meetup|networking|you'?re invited|registration (confirmed|successful)|rsvp|appointment booked|demo night|hack night)\b/i.test(subject) ||
      /^(invitation|updated invitation|canceled event|accepted|declined|reminder):/i.test(subject),
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
    test: ({ from, subject, snippet }) => {
      const money =
        /\b(invoice|bill|billing statement|statement|receipt|subscription|credits? remaining|free (plan|trial) (has )?ended|payment (failed|declined|scheduled)|renew(s|al)?|charged)\b/i.test(subject) || /credits? remaining|has been closed because/i.test(snippet ?? "");

      // A billing-adjacent sender is not enough on its own. AWS, SDG&E and
      // Cloudflare all send account invites, access grants and login alerts
      // from the same address as their bills — matching the sender alone filed
      // three of those under Money. Require billing language in the subject.
      const billingSender = /amazonaws|yardi|sdge|notify\.cloudflare/i.test(from);
      const billingOnlySender = /billing@|invoice[s+]|receipts?[@+]/i.test(from);

      return billingOnlySender || (billingSender && money) || money;
    },
  },
  {
    label: "Build",
    why: "dev services — high volume, low urgency",
    test: ({ from, subject }) =>
      /github\.com|gitlab|vercel\.com|netlify|pypi\.org|npmjs|aiven\.io|render\.com|railway|supabase|neon\.tech|circleci|sentry/i.test(from) ||
      /\b(deployed|deployment|pull request|\bPR #\d+|merged|build (failed|passed)|oauth application)\b/i.test(subject),
  },
];

/** Every label a message should get: the primary, plus any secondaries. */
export function labelsFor(msg, services = []) {
  const primary = classify(msg);
  if (!primary) return [];
  const out = [primary.label];
  for (const s of SECONDARY) {
    try {
      if (s.when(msg, primary.label, services)) out.push(s.label);
    } catch {
      /* a bad secondary must not drop the primary */
    }
  }
  return out;
}

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
