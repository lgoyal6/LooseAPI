/**
 * Cost and credit extraction from Gmail message metadata.
 *
 * Input is metadata only — sender, subject, snippet, date. Bodies are never
 * fetched, which keeps this usable under a metadata-only Gmail scope and means
 * the scan stays cheap.
 *
 * The one non-obvious rule: payment processors are not merchants. A receipt
 * from `receipts+acct_XXXX@stripe.com` tells you Stripe moved the money, not
 * who took it. The merchant lives in the subject ("Your receipt from Railway
 * Corporation"), so processor mail is attributed by subject, never by domain.
 * A domain-keyed dictionary alone files every Stripe receipt under "Stripe".
 */

/** Senders that bill on behalf of someone else. Attribute these by subject. */
const PROCESSORS = new Set([
  "stripe.com",
  "withorb.com", // Orb — Exa Labs invoices arrive through it
  "paddle.com",
  "paddle.net",
  "chargebee.com",
  "recurly.com",
  "lemonsqueezy.com",
]);

/**
 * Personal-finance senders. These emit textbook billing language ("invoice has
 * been paid", "payment scheduled") and would otherwise dominate the report —
 * a real inbox scan surfaced Chase card payments, SDGE utilities, renters
 * insurance, and a Greyhound booking alongside the dev tools.
 *
 * They are classified, not dropped: `scope: "personal"` keeps them out of the
 * default view while staying available under `--all`.
 */
const PERSONAL = [
  "chase.com",
  "sdge.com",
  "policyverify.io",
  "greyhound.com",
  "yardi.com",
  "upstox.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "paypal.com",
  "venmo.com",
];

/**
 * Ordered money patterns. First match wins, so put the labelled forms ahead of
 * the bare-dollar fallback — "Amount paid $25.00" must not be beaten by an
 * earlier "$0.00 due" elsewhere in the same snippet.
 */
const MONEY_PATTERNS = [
  /amount\s+paid[:\s]+\$?([\d,]+\.\d{2})/i,
  /(?:total|amount\s+due|you\s+(?:were|will\s+be)\s+charged)[:\s]+\$?([\d,]+\.\d{2})/i,
  /invoice\s+[A-Z0-9-]+:\s*\$?([\d,]+\.\d{2})/i,
  /\$\s?([\d,]+\.\d{2})\b/,
];

/** "USD $10 credits remaining" / "$29 credits remaining" */
const CREDIT_BALANCE = /(?:USD\s*)?\$\s?([\d,]+(?:\.\d{2})?)\s+credits?\s+remaining/i;

/** Merchant name out of a processor receipt subject. */
const MERCHANT_PATTERNS = [
  /receipt\s+from\s+(.+?)\s*(?:[[(]?#|$)/i,
  /invoice\s+from\s+(.+?)\s*(?:[[(]?#|$)/i,
  /your\s+(.+?)\s+receipt\b/i,
];

/**
 * Event classifiers, most urgent first. `kind` drives alerting; `severity`
 * decides whether the digest leads with it.
 *
 * `alert: true` means "tell me even if nothing else changed" — these are the
 * classes that cost money or end access silently.
 */
const EVENT_RULES = [
  {
    kind: "account_closed",
    severity: 3,
    alert: true,
    test: (t) => /has been closed|account (?:is|was) (?:closed|suspended|terminated)/i.test(t),
  },
  {
    kind: "credits_exhausted",
    severity: 3,
    alert: true,
    test: (t) => /credits have been (?:used|exhausted)|100%\s+of\s+credits\s+used|free (?:plan|tier|trial) has ended|run out of credits/i.test(t),
  },
  {
    kind: "payment_failed",
    severity: 3,
    alert: true,
    test: (t) => /payment (?:failed|declined|unsuccessful)|card (?:was )?declined|action required.*payment/i.test(t),
  },
  {
    kind: "trial_converting",
    severity: 3,
    alert: true,
    // "first charge on August 17" / "will be charged $29.99" — a dated future
    // charge you agreed to and will not remember agreeing to.
    test: (t) =>
      /(?:first charge|will be charged|charged automatically|auto-?renews?)\b/i.test(t) &&
      /trial|free\s+\d+[- ]day/i.test(t),
  },
  {
    kind: "trial_ending",
    severity: 2,
    alert: true,
    test: (t) => /trial (?:ends|ending|expires|will end)|trial period is (?:ending|over)|converts? to paid/i.test(t),
  },
  {
    kind: "credits_low",
    severity: 2,
    alert: true,
    test: (t) => CREDIT_BALANCE.test(t),
  },
  {
    kind: "subscription_cancelled",
    severity: 0,
    alert: false,
    test: (t) =>
      /(?:you )?cancell?ed your (?:subscription|plan|trial)|subscription (?:has been |was )?cancell?ed|cancellation (?:is )?confirmed|won't be (?:charged|billed) again/i.test(t),
  },
  {
    kind: "credits_added",
    severity: 0,
    alert: false,
    test: (t) => /credits? (?:have been )?added|granted you|credit request/i.test(t),
  },
  {
    kind: "charge",
    severity: 1,
    alert: false, // promoted to an alert only when it's a repeat — see findAnomalies
    test: (t) => /receipt|invoice|payment (?:received|confirmation)|thank you for your (?:payment|purchase)|you (?:were|have been) charged/i.test(t),
  },
];

/** Registrable-ish domain from a From header. */
export function senderDomain(from) {
  const m = /<?([^<>@\s]+)@([^<>\s]+?)>?$/.exec((from || "").trim());
  if (!m) return null;
  return m[2].toLowerCase().replace(/\.$/, "");
}

function domainMatches(domain, candidate) {
  return domain === candidate || domain.endsWith("." + candidate);
}

function parseMoney(text) {
  for (const re of MONEY_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const cents = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
      if (Number.isFinite(cents)) return cents;
    }
  }
  return null;
}

function parseCreditBalance(text) {
  const m = CREDIT_BALANCE.exec(text);
  if (!m) return null;
  const cents = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function parseMerchant(subject) {
  for (const re of MERCHANT_PATTERNS) {
    const m = re.exec(subject || "");
    if (m) {
      // Trim trailing legal suffixes and receipt numbers.
      return m[1]
        .replace(/[,\s]+(?:Inc|LLC|Ltd|Corporation|Corp|Co|GmbH|B\.?V)\.?$/i, "")
        .replace(/\s*#[\d-]+\s*$/, "")
        .trim();
    }
  }
  return null;
}

/**
 * Classify one Gmail message into a spend event, or null if it carries no
 * billing signal.
 *
 * @param {{from:string, subject:string, snippet:string, date:string, id:string,
 *          labelIds?:string[]}} msg
 * @param {Array<{id:string,name:string,domains:string[]}>} services
 */
export function extractEvent(msg, services = []) {
  const domain = senderDomain(msg.from);
  if (!domain) return null;

  const text = `${msg.subject || ""} ${msg.snippet || ""}`;

  const rule = EVENT_RULES.find((r) => r.test(text));
  if (!rule) return null;

  const isProcessor = [...PROCESSORS].some((p) => domainMatches(domain, p));
  const merchantFromSubject = parseMerchant(msg.subject);

  // Attribution order: a processor must be named by its subject; a first-party
  // sender is named by the dictionary, falling back to its own domain.
  let service = null;
  let serviceId = null;
  if (isProcessor && merchantFromSubject) {
    service = merchantFromSubject;
    serviceId = merchantFromSubject.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  } else {
    const hit = services.find((s) => s.domains.some((d) => domainMatches(domain, d)));
    if (hit) {
      service = hit.name;
      serviceId = hit.id;
    } else {
      service = merchantFromSubject || domain.replace(/^(mail|email|notify|no-?reply)\./, "");
      serviceId = service.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
  }

  // Scope: dictionary hits and processor receipts are dev spend; the
  // personal-finance denylist is personal; anything else is unclassified and
  // shown only on request, so an unknown sender is never silently dropped.
  const isPersonal = PERSONAL.some((p) => domainMatches(domain, p));
  const hit = services.find((s) => s.domains.some((d) => domainMatches(domain, d)));
  const scope = isPersonal
    ? "personal"
    : hit?.category === "consumer"
      ? "consumer"
      : hit || isProcessor
        ? "dev"
        : "unknown";

  return {
    id: msg.id,
    date: msg.date,
    serviceId,
    service,
    scope,
    via: isProcessor ? domain : null,
    kind: rule.kind,
    severity: rule.severity,
    alert: rule.alert,
    amountCents:
      rule.kind === "charge" || rule.kind === "trial_converting" ? parseMoney(text) : null,
    creditsRemainingCents: parseCreditBalance(text),
    subject: msg.subject || "",
    // Unread-and-trashed is the exact failure mode that let AWS run for 6 days:
    // the mail arrived, carried the number, and was never read.
    unread: (msg.labelIds || []).includes("UNREAD"),
    trashed: (msg.labelIds || []).includes("TRASH"),
  };
}

/**
 * Extract events from many messages, newest first, nulls dropped.
 *
 * Charges are de-duplicated on (service, amount, calendar day): one payment can
 * generate two emails when a merchant runs an invoicing system in front of a
 * processor — Exa Labs bills through Orb and settles through Stripe, so the
 * same $25 arrives twice. Same-day-same-amount collapses; a genuine repeat on
 * a different day survives and is caught by findAnomalies.
 */
export function extractEvents(messages, services = []) {
  const events = messages
    .map((m) => extractEvent(m, services))
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const seen = new Set();
  return events.filter((e) => {
    if (e.kind !== "charge" || e.amountCents == null) return true;
    const key = `${e.serviceId}|${e.amountCents}|${e.date.slice(0, 10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Derive alerts that no single email reveals — these need the whole set.
 *
 * - repeat_charge: the same service charged the same amount twice inside a
 *   window. Caught the two $25 Exa Labs charges 8 days apart.
 * - credit_burndown: two credit-balance readings for one service, projected to
 *   zero at the observed rate. This is the alert that would have fired on AWS
 *   on Aug 17 with "~1 day left", instead of the silence that actually happened.
 * - new_merchant: a service's first charge in the scanned window, and it is
 *   recent. This is the surprise-subscription case — a lone charge is not an
 *   alert class on its own, so without this a brand-new $40/mo appears in the
 *   table and never in the digest.
 * - unread_money: a charge or closure that arrived and was never read.
 */
/** A date, as a human writes one. Projections are meaningless without one. */
const asOfDay = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);

export function findAnomalies(events, { repeatWindowDays = 35, newMerchantDays = 7 } = {}) {
  const alerts = [];
  const byService = new Map();
  for (const e of events) {
    if (!byService.has(e.serviceId)) byService.set(e.serviceId, []);
    byService.get(e.serviceId).push(e);
  }

  for (const [, list] of byService) {
    const charges = list.filter((e) => e.kind === "charge" && e.amountCents != null);
    for (let i = 0; i < charges.length; i++) {
      for (let j = i + 1; j < charges.length; j++) {
        if (charges[i].amountCents !== charges[j].amountCents) continue;
        const days = Math.abs(new Date(charges[i].date) - new Date(charges[j].date)) / 86400000;
        if (days > 0.5 && days <= repeatWindowDays) {
          alerts.push({
            kind: "repeat_charge",
            severity: 2,
            service: charges[i].service,
            message: `${charges[i].service} charged ${fmt(charges[i].amountCents)} twice in ${Math.round(days)} days`,
            evidence: [charges[i].id, charges[j].id],
          });
          i = j; // one alert per pair, don't re-report the same amount
          break;
        }
      }
    }

    // First-ever charge from this service, and recent enough to be news.
    if (charges.length === 1) {
      const only = charges[0];
      const ageDays = (Date.now() - new Date(only.date)) / 86400000;
      if (ageDays <= newMerchantDays) {
        alerts.push({
          kind: "new_merchant",
          severity: 2,
          service: only.service,
          message: `New charge from ${only.service}: ${fmt(only.amountCents)} (first one seen)`,
          evidence: [only.id],
        });
      }
    }

    // Credit burndown needs two readings of the same balance series.
    const credits = list
      .filter((e) => e.creditsRemainingCents != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (credits.length >= 2) {
      const a = credits[credits.length - 2];
      const b = credits[credits.length - 1];
      const days = (new Date(b.date) - new Date(a.date)) / 86400000;
      const spent = a.creditsRemainingCents - b.creditsRemainingCents;

      // A closure dated after the last reading settles the question the
      // projection was asking. Once the account is gone, repeating the
      // countdown is publishing a forecast for a day that has already been and
      // gone; the closure has its own alert and that is the one to read.
      const closed = list.find(
        (e) => e.kind === "account_closed" && new Date(e.date) >= new Date(b.date),
      );

      if (days > 0 && spent > 0 && !closed) {
        const perDay = spent / days;
        // Runway measured from the reading, then from now. Only the second is
        // an answer to "how long have I got", and this used to report the
        // first: AWS read $10 on Aug 17 and the alert still said "~1.3 days"
        // nine days later, every day, forever. A projection carries an as-of
        // date whether or not anyone prints it.
        const runway = b.creditsRemainingCents / perDay;
        const elapsed = (Date.now() - new Date(b.date)) / 86400000;
        const left = runway - elapsed;

        alerts.push(
          left > 0
            ? {
                kind: "credit_burndown",
                severity: left <= 3 ? 3 : 2,
                service: b.service,
                message:
                  `${b.service}: ${fmt(b.creditsRemainingCents)} credits left, ` +
                  `burning ${fmt(Math.round(perDay))}/day -> ~${left.toFixed(1)} days`,
                evidence: [a.id, b.id],
              }
            : {
                // Past its own horizon and no closure mail to explain it. The
                // honest report is not a countdown but a gap: the credits were
                // due to run out, nothing since has said whether they did, and
                // the mailbox is no longer a source of truth about it.
                kind: "credit_stale",
                severity: 2,
                service: b.service,
                message:
                  `${b.service}: ${fmt(b.creditsRemainingCents)} credits as of ` +
                  `${asOfDay(b.date)}, due to run out ${asOfDay(addDays(b.date, runway))}. ` +
                  `No reading in ${Math.round(elapsed)} days - check it directly.`,
                evidence: [a.id, b.id],
              },
        );
      }
    }
  }

  // Latest cancellation per service, so a converting-trial alert can be
  // suppressed when you already cancelled.
  const cancelledAt = new Map();
  for (const e of events) {
    if (e.kind !== "subscription_cancelled") continue;
    const prev = cancelledAt.get(e.serviceId);
    if (!prev || new Date(e.date) > new Date(prev)) cancelledAt.set(e.serviceId, e.date);
  }

  // A dated future charge deserves its own alert carrying the amount — that
  // number is the whole point and it is otherwise buried in the subject line.
  for (const e of events) {
    if (e.kind === "trial_converting") {
      const cancelled = cancelledAt.get(e.serviceId);
      if (cancelled && new Date(cancelled) >= new Date(e.date)) continue;
      alerts.push({
        kind: "trial_converting",
        severity: 3,
        service: e.service,
        message:
          `${e.service} trial converts to a real charge` +
          (e.amountCents != null ? ` of ${fmt(e.amountCents)}` : "") +
          ` — "${e.subject}"`,
        evidence: [e.id],
      });
    }
  }

  for (const e of events) {
    if (e.severity >= 2 && e.unread) {
      const cancelled = cancelledAt.get(e.serviceId);
      if (cancelled && new Date(cancelled) >= new Date(e.date)) continue;
      alerts.push({
        kind: "unread_money",
        severity: e.severity,
        service: e.service,
        message: `Unread${e.trashed ? " and trashed" : ""}: ${e.subject}`,
        evidence: [e.id],
      });
    }
  }

  return alerts.sort((a, b) => b.severity - a.severity);
}

/** Recurring monthly total, from charges seen in the last `days`. */
export function monthlyTotal(events, days = 35) {
  const cutoff = Date.now() - days * 86400000;
  return events
    .filter((e) => e.kind === "charge" && e.amountCents != null && new Date(e.date).getTime() >= cutoff)
    .reduce((sum, e) => sum + e.amountCents, 0);
}

export function fmt(cents) {
  if (cents == null) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}
