/**
 * The inbound path, against the message shapes forwarding actually produces.
 */
import { parseMessage, parseAll, unwrapForwarded, addressOf } from "../../lib/mail/inbound.mjs";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

// A Gmail *filter* forward: the original headers survive the relay, which is
// the mode worth asking users for.
const relayed = `Delivered-To: inbox@looseapi.dev
X-Forwarded-To: inbox@looseapi.dev
X-Forwarded-For: laksh@gmail.com inbox@looseapi.dev
Message-ID: <0100018f@email.amazonses.com>
Date: Mon, 17 Aug 2026 19:52:40 +0000
From: Amazon Web Services <no-reply@amazonaws.com>
Subject: Your credit balance remaining is $10
Content-Type: text/plain; charset=UTF-8

Your free plan account (ID: 000011112222) has USD $10 credits remaining.
`;

const m = parseMessage(relayed);
check("filter forward keeps the real sender", m.from, "no-reply@amazonaws.com");
check("subject survives", m.subject, "Your credit balance remaining is $10");
check("date is normalised to ISO", m.date, "2026-08-17T19:52:40.000Z");
check("body becomes the snippet", m.snippet.startsWith("Your free plan account"), true);
check("not flagged as a manual forward", m.forwarded, false);
// Labels are null, not empty: forwarding happens at delivery and cannot know
// what became of the copy left behind. An empty array would read as "read".
check("labels are unknown, not absent", m.labelIds, null);

// The Forward button: a new message from the user, original quoted in the body.
// Taken at face value every service resolves to gmail.com and the whole thing
// silently produces nothing.
const byHand = `Message-ID: <CAJ7x@mail.gmail.com>
Date: Tue, 26 Aug 2026 21:04:11 -0700
From: Laksh Goyal <laksh@gmail.com>
To: inbox@looseapi.dev
Subject: Fwd: Your AWS free plan has ended - Action required
Content-Type: text/plain; charset="UTF-8"

---------- Forwarded message ---------
From: Amazon Web Services <no-reply@amazonaws.com>
Date: Wed, 19 Aug 2026 03:30:22 +0000
Subject: Your AWS free plan has ended - Action required
To: Laksh Goyal <laksh@gmail.com>

Your AWS account (ID: 000011112222) has been closed because all free plan
credits have been used.
`;

const f = parseMessage(byHand);
check("manual forward recovers the original sender", f.from, "no-reply@amazonaws.com");
check("manual forward recovers the original subject", f.subject, "Your AWS free plan has ended - Action required");
check("manual forward recovers the original date", f.date, "2026-08-19T03:30:22.000Z");
check("manual forward is flagged", f.forwarded, true);
check("the forwarder's own banner is not the snippet", f.snippet.startsWith("Your AWS account"), true);

// Encoded subjects: a currency symbol arrives as an encoded word, and
// "Your bill for =?utf-8?q?=C2=A320?=" is not a subject.
const encoded = `Message-ID: <e1@x>
Date: Mon, 17 Aug 2026 19:52:40 +0000
From: billing@example.com
Subject: =?utf-8?q?Your_invoice_for_=C2=A320=2E00?=

body
`;
check("encoded-word subjects are decoded", parseMessage(encoded).subject, "Your invoice for £20.00");

// quoted-printable and multipart, which is what most real receipts are.
const multipart = `Message-ID: <mp1@x>
Date: Mon, 17 Aug 2026 19:52:40 +0000
From: Vercel <billing@vercel.com>
Subject: Your receipt
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

You were charged =2420.00 for the Pro plan.
--b1
Content-Type: text/html; charset=UTF-8

<p>You were charged $20.00</p>
--b1--
`;
const mp = parseMessage(multipart);
check("multipart takes the plain part", mp.snippet, "You were charged $20.00 for the Pro plan.");

// The id has to survive re-ingestion. The ledger is keyed on it, and an id that
// changed per run would file the same charge repeatedly and report a duplicate
// charge that never happened.
check("ids are stable across parses", parseMessage(relayed).id, m.id);
check("different messages get different ids", parseMessage(byHand).id !== m.id, true);

// One unreadable message must not lose the rest of the batch.
const mbox = `From MAILER-DAEMON Mon Aug 17 19:52:40 2026
${relayed}
From MAILER-DAEMON Tue Aug 26 21:04:11 2026
this is not a message at all
From MAILER-DAEMON Wed Aug 19 03:30:22 2026
${byHand}`;
const batch = parseAll(mbox);
check("an mbox yields every readable message", batch.length, 2);
check("and the junk between them is dropped", batch.map((x) => x.from),
  ["no-reply@amazonaws.com", "no-reply@amazonaws.com"]);

check("addresses come out of angle brackets", addressOf("AWS <no-reply@amazonaws.com>"), "no-reply@amazonaws.com");
check("bare addresses survive", addressOf("billing@vercel.com"), "billing@vercel.com");
check("no banner means nothing to unwrap", unwrapForwarded("just a body"), null);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
