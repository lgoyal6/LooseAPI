/**
 * Fixtures taken verbatim from a real inbox (sender, subject, snippet, labels)
 * on 2026-08-26, with account identifiers replaced. These are the real shapes the parser has to survive, including
 * the AWS burndown sequence that went unread and the duplicate Exa charge.
 */
export const MESSAGES = [
  {
    id: "1a01811eec73d278",
    date: "2026-08-19T03:30:22Z",
    from: "no-reply@amazonaws.com",
    subject: "Your AWS free plan has ended - Action required",
    snippet:
      "Your AWS account (ID: 000011112222) has been closed because all free plan credits have been used. To restore access to your AWS resources, upgrade to a paid plan by November 17, 2026. After",
    labelIds: ["UNREAD", "TRASH"],
  },
  {
    id: "1a0114886d581845",
    date: "2026-08-17T19:52:40Z",
    from: "no-reply@amazonaws.com",
    subject: "Your credit balance remaining is $10",
    snippet:
      "Your free plan account (ID: 000011112222) has USD $10 credits remaining. You can earn up to an additional USD $80 credits by exploring 4 services by 25 Oct 2026. After your 6 months free plan",
    labelIds: ["UNREAD", "INBOX"],
  },
  {
    id: "1a004f4774bf79ce",
    date: "2026-08-15T10:25:24Z",
    from: "no-reply@amazonaws.com",
    subject: "Your credit balance remaining is $29",
    snippet:
      "Your free plan account (ID: 000011112222) has USD $29 credits remaining. You can earn up to an additional USD $80 credits by exploring 4 services by 25 Oct 2026. After your 6 months free plan",
    labelIds: ["UNREAD", "TRASH"],
  },
  {
    id: "19fafb31f313c17f",
    date: "2026-07-29T21:06:19Z",
    from: "receipts+acct_EXAMPLE0001@stripe.com",
    subject: "Your Exa Labs, Inc. receipt [#0000-0001]",
    snippet:
      "Receipt from Exa Labs, Inc. [#0000-0001] Amount paid $25.00 Date paid Jul 29, 2026, 2:04:56 PM",
    labelIds: ["INBOX"],
  },
  {
    id: "19f85bf93814416a",
    date: "2026-07-21T17:35:51Z",
    from: "receipts+acct_EXAMPLE0001@stripe.com",
    subject: "Your Exa Labs, Inc. receipt [#0000-0002]",
    snippet:
      "Receipt from Exa Labs, Inc. [#0000-0002] Amount paid $25.00 Date paid Jul 21, 2026, 10:34:33 AM",
    labelIds: ["UNREAD", "INBOX"],
  },
  {
    id: "1a00a8151f6bb201",
    date: "2026-08-16T12:17:20Z",
    from: "noreply@notify.cloudflare.com",
    subject: "Your invoice is available",
    snippet:
      "Invoice IN-00000001: $0.00 due August 16, 2026 Cloudflare logo Your invoice is ready View invoice Your latest Cloudflare invoice is ready for review. Invoice details: Account ID:",
    labelIds: ["UNREAD", "TRASH"],
  },
  {
    id: "19fcf6ad8918af17",
    date: "2026-08-05T00:55:13Z",
    from: "invoice+statements+acct_EXAMPLE0002@stripe.com",
    subject: "Your receipt from Railway Corporation #0000-0003",
    snippet: "Your receipt from Railway Corporation #0000-0003",
    labelIds: ["UNREAD", "INBOX"],
  },
  {
    id: "19f96e6af9f0469e",
    date: "2026-07-25T01:32:07Z",
    from: "invoice+statements@vercel.com",
    subject: "Your receipt from Vercel Inc. #0000-0004",
    snippet: "Your receipt from Vercel Inc. #0000-0004",
    labelIds: ["UNREAD", "INBOX"],
  },
  {
    id: "1a0120587125be1d",
    date: "2026-08-17T23:19:07Z",
    from: "no-reply@mail.anthropic.com",
    subject: "Your Claude API Credits",
    snippet:
      "Hi Laksh, Thank you for submitting your Claude API credit request form. I'm pleased to inform you that credits have been added to your Account. As a reminder, these credits are available to use",
    labelIds: ["UNREAD", "TRASH"],
  },
  // Negative control: a real email with no billing signal. Must not be picked up.
  {
    id: "19fe7d2d8c3dc463",
    date: "2026-08-09T18:39:42Z",
    from: "em@em1.cloudflare.com",
    subject: "Last chance: $100 off Connect 2026",
    snippet: "Agents Week is a wrap - here are all the launches, and your code before it expires today",
    labelIds: ["TRASH"],
  },
];
