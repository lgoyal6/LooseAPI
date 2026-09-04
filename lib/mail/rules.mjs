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

/**
 * Verification codes, account activations and password resets.
 *
 * The header above says these are deliberately unlabelled, but that intent was
 * only ever honoured by omission. The sender-domain arms of Jobs/Closed and
 * Build match an ATS or a git host whatever the subject says, so an OTP from
 * otp.workday.com was filed as a closed application and a login code from
 * Optiver as an open one. This is the same failure the Money rule already
 * guards against: a topical sender is not enough on its own.
 *
 * Tested before any rule, so one guard covers every bucket. Deliberately not
 * matching a bare "welcome to": "Welcome to Cresta's 1st Technical Interview"
 * is a real interview, so that phrase cannot be used to detect account setup.
 */
export const TRANSACTIONAL =
  /\b(security|verification|sign.?in|login|one.?time|access)\s+code\b|\b(verify|confirm)\s+your\s+(email|identity|account|candidate\s+account)\b|\baccount\s+created\b|\bpassword\s+(setup|reset)\b/i;

/**
 * Event evidence strong enough to outrank a jobs-shaped sender.
 *
 * MLH, Y Combinator, vFairs and Basta all run events *and* recruit, from the
 * same domains, so the Jobs/Closed sender arm was claiming their hackathon and
 * career-fair invitations before the Events rule could see them.
 *
 * Only an explicit invitation, a confirmed registration or a calendar header
 * counts. A bare topic word must not, or "An update on your Fast Hackathon
 * application" becomes an Event when it is plainly a closed application.
 *
 * Note `you.?re`: the straight apostrophe in the Events rule below missed every
 * invitation written with a curly one.
 */
export const EVENT_STRONG =
  /\byou.?re invited\b|\byou.?re confirmed\b|\bon the waitlist\b|\b(career|internship|job) fair\b|\bregistration (is )?(confirmed|approved|successful)\b|\brsvp\b|\bis happening (soon|tomorrow|today)\b|\bappointment booked\b|^(invitation|updated invitation|canceled event|reminder):/i;

/** first match wins */
export const RULES = [
  {
    // Job mail identified by what the subject says. Split from the sender-domain
    // arm below so that this half outranks Events and that half does not: an
    // assessment invite is a deadline whatever else it looks like, while a bare
    // recruiting domain must lose to a genuine invitation.
    label: "Jobs",
    why: "job mail: an assessment, an interview, or an application",
    test: ({ from, subject }) =>
      /hackerrank|codesignal|karat|hackerearth|codility|hirevue|coderpad/i.test(from) ||
      /\b(assessment|online assessment|\bOA\b|technical test|coding challenge|interview|schedule.*(interview|call)|take.?home)\b/i.test(subject) ||
      /invitation to complete|next step in your .* application|take the next step/i.test(subject) ||
      /thank you for (applying|your interest)|application (received|next steps|status)|unable to move forward|not (be )?moving forward|we regret/i.test(subject) ||
      /candidate profile|update on your application|application (is )?(under|in) review|resume scored|fellowship application/i.test(subject),
  },
  {
    // Sits above the recruiting-domain arm so an invitation beats a domain, and
    // below the subject arm so an interview invite is still the deadline it is.
    label: "Events",
    why: "an invitation, not an application",
    test: ({ subject }) => EVENT_STRONG.test(subject ?? ""),
  },
  {
    label: "Jobs",
    why: "a known recruiting platform, with nothing more specific to go on",
    test: ({ from }) =>
      /greenhouse|lever\.co|myworkday|workday|paycomonline|jobvite|smartrecruiters|icims|ashbyhq|experis|taleo|recruitment\.|careers\.|ycombinator|projectbasta|mlh\.io|eprivatemail|successfactors|avature/i.test(from),
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
  {
    // Last on purpose. Its topic words are weak evidence: a GitHub Actions
    // failure for the hacklist-sf repo was filed as an Event because the repo
    // name contains "hackathon". Anything with a precise sender (Build) or an
    // explicit amount (Money, Orders) is a better answer than a topic word.
    label: "Events",
    why: "date-bound: hackathons, meetups, calls",
    test: ({ from, subject }) =>
      /luma-mail|lu\.ma|eventbrite|meetup\.com|hopin|getvfairs|calendar\.google|zcal\.co|calendly/i.test(from) ||
      /\b(hackathon|meetup|networking|you'?re invited|registration (confirmed|successful)|rsvp|appointment booked|demo night|hack night)\b/i.test(subject) ||
      /^(invitation|updated invitation|canceled event|accepted|declined|reminder):/i.test(subject),
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
  if (TRANSACTIONAL.test(msg.subject ?? "")) return null;
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
