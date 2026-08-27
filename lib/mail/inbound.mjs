/**
 * Mail arriving at an address, rather than read out of an inbox.
 *
 * Reading someone's inbox needs `gmail.readonly`, which Google classifies as a
 * restricted scope: an annual CASA security assessment, quoted between a few
 * thousand and tens of thousands of dollars, and six to twelve weeks for a
 * first cycle. That is a wall for anyone who is not already a company, and it
 * gates the only useful version of this product for anyone but its author.
 *
 * A forwarding address needs none of it. The user writes one Gmail filter that
 * forwards billing mail onward, and what arrives here is an ordinary message.
 * No access to the mailbox, no scope, no assessment, and a better answer to the
 * first question a company asks, which is what else you can see.
 *
 * # Two kinds of forward, and only one of them is honest about the sender
 *
 * Gmail's *filter* forwarding relays the original message: the `From` header is
 * still AWS, and a `X-Forwarded-To` header is added. That is the mode to ask
 * for, because the sender is the single most important field here — every
 * service is identified by its domain.
 *
 * Gmail's *Forward* button does not. It sends a new message from the user, with
 * the original quoted in the body under a `---------- Forwarded message
 * ---------` banner. Taken at face value, every message looks like it came from
 * the person who forwarded it, every service resolves to gmail.com, and the
 * whole thing silently produces nothing. People will do this at least once, so
 * the banner is parsed and the original headers recovered from it.
 *
 * # What forwarding cannot carry
 *
 * Labels. The strongest signal in the mailbox version is that a billing warning
 * arrived and was never read, which is how the founding AWS case was caught,
 * and forwarding happens at delivery so nothing downstream can know what
 * happened to the copy that stayed behind. Messages ingested this way carry no
 * labels rather than empty ones, so the unread checks skip them instead of
 * quietly reporting every forwarded message as read.
 */

import { createHash } from "node:crypto";

/** Headers are folded onto continuation lines that begin with whitespace. */
function unfold(head) {
  return head.replace(/\r?\n[ \t]+/g, " ");
}

function splitMessage(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const i = text.indexOf("\n\n");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 2)];
}

function headers(head) {
  const out = {};
  for (const line of unfold(head).split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    // First occurrence wins. Relayed mail accumulates Received and
    // X-Forwarded-* headers, and the earliest is the one about this hop.
    if (!(name in out)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

/** RFC 2047, as in `=?UTF-8?B?...?=`. Subjects with a currency symbol arrive
 *  encoded, and "Your bill for =?utf-8?q?=C2=A320?=" is not a subject. */
function decodeWords(s = "") {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, body) => {
    try {
      if (enc.toUpperCase() === "B") {
        return Buffer.from(body, "base64").toString(charset.toLowerCase().startsWith("utf") ? "utf8" : "latin1");
      }
      const bytes = body.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) =>
        String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, "binary").toString("utf8");
    } catch {
      return body;
    }
  });
}

function decodeBody(body, enc = "") {
  const e = enc.toLowerCase();
  if (e === "base64") {
    try {
      return Buffer.from(body, "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (e === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

/** The text/plain part, or the whole body when the message is not multipart. */
function plainText(head, body) {
  const h = headers(head);
  const ct = h["content-type"] || "";
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (!boundary) return decodeBody(body, h["content-transfer-encoding"]);

  for (const part of body.split(`--${boundary}`)) {
    const [ph, pb] = splitMessage(part.replace(/^\n+/, ""));
    const pheaders = headers(ph);
    const type = pheaders["content-type"] || "";
    if (/text\/plain/i.test(type)) {
      return decodeBody(pb, pheaders["content-transfer-encoding"]);
    }
    // A nested multipart/alternative: recurse rather than give up, because
    // multipart/mixed wrapping multipart/alternative is the common shape.
    if (/multipart\//i.test(type)) {
      const inner = plainText(ph, pb);
      if (inner) return inner;
    }
  }
  return "";
}

const FORWARD_BANNER = /-{2,}\s*Forwarded message\s*-{2,}/i;

/**
 * Recover the original headers from a manually forwarded message.
 *
 * Returns null when there is no banner, which is the good case: a filter
 * forward already has the right sender and nothing needs recovering.
 */
export function unwrapForwarded(text) {
  const at = text.search(FORWARD_BANNER);
  if (at < 0) return null;

  // Walk the quoted headers rather than counting blank lines between them.
  // Some clients put a blank line after the banner and some do not, and
  // slicing on paragraph breaks silently takes the wrong one in whichever
  // shape it was not written against.
  const lines = text.slice(at).split("\n");
  const head = [];
  let i = 1; // past the banner itself
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the block only once something header-shaped has been
      // seen; a blank immediately under the banner is just spacing.
      if (head.length) {
        i++;
        break;
      }
      continue;
    }
    if (!/^\s*[\w-]+:\s/.test(line)) break;
    head.push(line);
  }

  const block = head.join("\n");
  const field = (name) =>
    new RegExp(`^\\s*${name}:\\s*(.+)$`, "im").exec(block)?.[1]?.trim() || "";

  const from = field("From");
  if (!from) return null; // a banner with no sender recovers nothing

  return {
    from: decodeWords(from),
    subject: decodeWords(field("Subject")),
    date: field("Date"),
    body: lines.slice(i).join("\n"),
  };
}

/** An address out of `Name <addr@host>`, or the string if it is bare. */
export function addressOf(s = "") {
  return (/<([^>]+)>/.exec(s)?.[1] || s).trim().toLowerCase();
}

const SNIPPET = 400;

/**
 * parseMessage turns one RFC-822 message into the shape the spend parser and
 * the inbox classifier both already take.
 *
 * The id is a hash of the message id, or of the sender, subject and date when
 * there is none. It has to be stable across re-ingestion of the same file: the
 * ledger is keyed on it, and an id that changed on every run would file the
 * same charge repeatedly and report a duplicate that never happened.
 */
export function parseMessage(raw) {
  const [head, rawBody] = splitMessage(String(raw));
  const h = headers(head);

  let from = decodeWords(h.from || "");
  let subject = decodeWords(h.subject || "");
  let date = h.date || "";
  let body = plainText(head, rawBody);

  const original = unwrapForwarded(body);
  if (original) {
    from = original.from;
    subject = original.subject || subject;
    date = original.date || date;
    body = original.body;
  }

  const parsed = date ? new Date(date) : null;
  const iso = parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : null;

  const key = h["message-id"] || `${from}|${subject}|${date}`;
  return {
    id: createHash("sha1").update(key).digest("hex").slice(0, 16),
    date: iso,
    from: addressOf(from),
    subject,
    snippet: body.replace(/\s+/g, " ").trim().slice(0, SNIPPET),
    // Not [] : a forwarded message carries no knowledge of what happened to the
    // copy that stayed in the inbox, and an empty array reads as "no labels,
    // therefore read", which would report every one of these as seen.
    labelIds: null,
    via: "forward",
    forwarded: Boolean(original),
  };
}

/** parseAll accepts a mailbox file or a single message and returns what it
 *  could read. A message that will not parse is skipped rather than fatal:
 *  ingesting fifty and failing on one must not lose the forty-nine. */
export function parseAll(raw) {
  const text = String(raw).replace(/\r\n/g, "\n");
  // mbox: messages separated by a From_ line at the start of a line.
  const chunks = /^From \S+ /m.test(text)
    ? text.split(/^From \S+ .*$/m).filter((c) => c.trim())
    : [text];

  const out = [];
  for (const c of chunks) {
    try {
      const m = parseMessage(c);
      if (m.from && (m.subject || m.snippet)) out.push(m);
    } catch {
      /* one unreadable message must not lose the rest */
    }
  }
  return out;
}
