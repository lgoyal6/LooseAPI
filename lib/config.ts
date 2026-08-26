/**
 * App configuration. All values here are safe to ship to the browser.
 *
 * LOCAL-FIRST INVARIANT: nothing in this app sends Gmail content to our own
 * servers. The only Google credential we hold is a short-lived, in-memory
 * access token obtained via the GIS token model (see lib/google-auth.ts).
 */

/** OAuth client ID for the GIS token flow. Public by design (see Google docs). */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/**
 * Restricted scope. Read-only Gmail access; we never request write scopes.
 * NOTE: every Gmail scope (incl. gmail.metadata) is "restricted" per Google,
 * so this choice does not change the CASA requirement — we use readonly so we
 * can also read bodies client-side later for trial-date extraction.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** Max messages to pull per scan in v1 (keeps a scan snappy). */
export const SCAN_CAP = 300;

/** A service with no activity in this many days is flagged "dormant". */
export const DORMANT_DAYS = 60;

/**
 * Gmail search query that biases toward signup / receipt / trial / billing mail
 * so we don't fetch the whole inbox. Broad on purpose — we classify client-side.
 */
export const SCAN_QUERY = [
  "newer_than:2y",
  '(subject:(welcome OR verify OR confirm OR receipt OR invoice OR trial OR',
  'subscription OR "get started" OR "sign up" OR renewal OR payment OR',
  '"free tier" OR credits) OR from:(noreply OR no-reply OR notifications OR',
  "billing OR support OR team OR hello OR account))",
].join(" ");
