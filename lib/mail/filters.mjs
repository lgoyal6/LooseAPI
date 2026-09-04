/**
 * Gmail server-side filters, so labelling happens at delivery instead of
 * whenever this machine next runs a sweep.
 *
 * The catch that shapes everything below: Gmail filters are **not** the same
 * engine as `rules.mjs`. Those rules are ordered regex with first-match-wins;
 * Gmail queries have no regex and no ordering — every filter whose query
 * matches fires, independently. Port the rules naively and a Greenhouse email
 * saying "invitation to complete the assessment" lands in Jobs/Active *and*
 * Jobs/Closed.
 *
 * So the queries here are made mutually exclusive by construction: each lower
 * -priority query carries the negation of the ones above it. That is what the
 * `-{...}` clauses are doing, and it is why they must stay in sync with
 * ACTIVE_TERMS and friends rather than being hand-edited apart.
 *
 * Every query also negates TRANSACTIONAL_TERMS, so one-time codes stay
 * unlabelled here exactly as they do in the sweep.
 *
 * Filters apply to newly delivered mail only. Existing mail needs the one-time
 * sweep (`spend --label`); the two together are what make this complete.
 */
import { loadConfig } from "../spend/gmail.mjs";

/**
 * Verification codes and account setup. Mirrors TRANSACTIONAL in rules.mjs.
 *
 * Negated out of every filter below for the same reason the sweep skips them:
 * an OTP from otp.workday.com matches the Jobs/Closed sender list, and a label
 * on a code that expires in ten minutes is pure churn.
 */
const TRANSACTIONAL_TERMS =
  '{subject:"verification code" subject:"security code" subject:"login code" ' +
  'subject:"access code" subject:"verify your identity" subject:"confirm your identity" ' +
  'subject:"verify your account" subject:"verify your email" subject:"account created" ' +
  'subject:"password setup" subject:"password reset"}';

/** Deadline-bearing job mail. Highest priority, so nothing negates it. */
const ACTIVE_TERMS =
  '{subject:assessment subject:"online assessment" subject:interview subject:"technical test" ' +
  'subject:"coding challenge" subject:"take-home" subject:"invitation to complete" ' +
  'subject:"next step" from:hackerrank from:codesignal from:karat from:codility}';

/** Applied-or-rejected job mail. */
const CLOSED_SENDERS =
  "{from:greenhouse-mail.io from:lever.co from:myworkday.com from:paycomonline.com " +
  "from:jobvite.com from:smartrecruiters.com from:icims.com from:ashbyhq.com from:experis.com}";
const CLOSED_TERMS =
  '{subject:"thank you for applying" subject:"thank you for your interest" ' +
  'subject:"application received" subject:"unable to move forward" subject:"candidate profile"}';

/**
 * Event evidence strong enough to outrank a recruiting sender. Mirrors
 * EVENT_STRONG in rules.mjs, and is negated out of Jobs/Closed below so an
 * MLH or YC invitation is not filed as a closed application.
 */
const EVENT_STRONG_TERMS =
  '{subject:"you\'re invited" subject:"you are invited" subject:"you\'re confirmed" ' +
  'subject:"on the waitlist" subject:"career fair" subject:"internship fair" ' +
  'subject:"registration is confirmed" subject:"registration confirmed" ' +
  'subject:"registration approved" subject:rsvp subject:"is happening soon" ' +
  'subject:"appointment booked" subject:invitation}';

const EVENT_SENDERS = "{from:luma-mail.com from:lu.ma from:eventbrite.com from:meetup.com from:getvfairs.com}";
const EVENT_TERMS =
  '{subject:hackathon subject:meetup subject:networking subject:"you are invited" ' +
  'subject:"registration confirmed" subject:rsvp subject:"appointment booked"}';

const ORDER_TERMS =
  '{subject:"order confirmed" subject:"order summary" subject:"on its way" subject:"has shipped" ' +
  'subject:"tracking number" subject:"transaction failed" subject:"your purchase"}';

const MONEY_TERMS =
  '{subject:invoice subject:"billing statement" subject:subscription subject:"credits remaining" ' +
  'subject:"payment failed" subject:renewal from:amazonaws.com from:notify.cloudflare.com}';

const BUILD_SENDERS =
  "{from:github.com from:gitlab.com from:vercel.com from:netlify.com from:pypi.org " +
  "from:aiven.io from:render.com from:railway.app from:supabase.com from:neon.tech from:sentry.io}";

/**
 * Six filters, in the same precedence order as rules.mjs. Each query excludes
 * every higher-priority query so exactly one can match.
 *
 * `category:promotions` is excluded throughout — Gmail already sorts marketing,
 * and a shop's promo blast is not an order.
 */
export const FILTERS = [
  {
    // Jobs/Active and Jobs/Closed merged: nothing in the closed bucket was ever
    // actually closed (48 pending applications, 77 ATS admin, 0 rejections), so
    // the split promised a distinction the mail does not contain.
    //
    // Event terms are still negated, because MLH, YC and vFairs recruit and run
    // events from one domain and the invitation is the more useful reading.
    label: "Jobs",
    query: `{${ACTIVE_TERMS} ${CLOSED_SENDERS} ${CLOSED_TERMS}} -${EVENT_STRONG_TERMS} -category:promotions -${TRANSACTIONAL_TERMS}`,
  },
  {
    // BUILD_SENDERS is negated because EVENT_TERMS carries topic words: a
    // GitHub Actions failure for a repo named hacklist-sf matched
    // subject:hackathon and was labelled both Events and Build.
    label: "Events",
    query: `{${EVENT_SENDERS} ${EVENT_TERMS}} -${ACTIVE_TERMS} -${BUILD_SENDERS} -category:promotions -${TRANSACTIONAL_TERMS}`,
  },
  {
    label: "Orders",
    query: `${ORDER_TERMS} -${ACTIVE_TERMS} -${EVENT_TERMS} -category:promotions -${TRANSACTIONAL_TERMS}`,
  },
  {
    label: "Money",
    query: `${MONEY_TERMS} -${ORDER_TERMS} -${ACTIVE_TERMS} -category:promotions -${TRANSACTIONAL_TERMS}`,
  },
  {
    label: "Build",
    query: `${BUILD_SENDERS} -${ACTIVE_TERMS} -${MONEY_TERMS} -category:promotions -${TRANSACTIONAL_TERMS}`,
  },
];

async function accessToken(cfg) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed (${res.status})`);
  return (await res.json()).access_token;
}

/**
 * Create the six filters. Idempotent: an existing filter with the same query is
 * left alone rather than duplicated, because Gmail happily stores duplicates
 * and there is no natural key to update against.
 *
 * @param {{dryRun?: boolean}} opts
 */
export async function installFilters({ dryRun = true } = {}) {
  const cfg = await loadConfig();
  if (!(cfg.clientId && cfg.clientSecret && cfg.refreshToken))
    return { ok: false, reason: "no Gmail credential — see SETUP.md" };

  const token = await accessToken(cfg);
  const auth = { authorization: `Bearer ${token}` };

  const lr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers: auth });
  if (!lr.ok) return { ok: false, reason: `labels list failed (${lr.status})` };
  const labelId = Object.fromEntries((await lr.json()).labels.map((l) => [l.name, l.id]));

  const er = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/filters", {
    headers: auth,
  });
  if (!er.ok)
    return {
      ok: false,
      reason:
        er.status === 403
          ? "scope gmail.settings.basic not granted — re-consent required"
          : `filters list failed (${er.status})`,
    };
  // An account with no filters returns an empty body, not `{}` — parsing that
  // throws, so read text first.
  const raw = (await er.text()).trim();
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: `filters list returned unparseable body` };
    }
  }
  const existing = new Set((parsed.filter ?? []).map((f) => f.criteria?.query));

  const planned = [];
  for (const f of FILTERS) {
    const id = labelId[f.label];
    if (!id) {
      planned.push({ ...f, status: "missing label" });
      continue;
    }
    if (existing.has(f.query)) {
      planned.push({ ...f, status: "already exists" });
      continue;
    }
    if (dryRun) {
      planned.push({ ...f, status: "would create" });
      continue;
    }
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/filters", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ criteria: { query: f.query }, action: { addLabelIds: [id] } }),
    });
    planned.push({ ...f, status: res.ok ? "created" : `failed ${res.status}` });
  }
  return { ok: true, dryRun, planned };
}
