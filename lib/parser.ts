/**
 * Turn raw messages into a deduped list of detected services. Pure functions,
 * no I/O — easy to unit test and runs entirely client-side.
 */
import { DORMANT_DAYS } from "./config";
import { classifyEvent, matchService, type ServiceSignature } from "./services";
import type { DetectedService, EventKind, Tier } from "./types";
import type { RawMessage } from "./gmail";

const DAY_MS = 86_400_000;

interface ParsedFrom {
  email: string;
  domain: string;
  name: string;
}

/** Parse a `From` header of the form `Name <user@host>` or bare `user@host`. */
export function parseFrom(from: string): ParsedFrom {
  const angle = from.match(/<([^>]+)>/);
  const email = (angle ? angle[1] : from).trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1] : "";
  const name = angle
    ? from.slice(0, angle.index).replace(/["']/g, "").trim()
    : "";
  return { email, domain, name };
}

/** Prettify a bare domain into a display name, e.g. `mail.acme.co` -> `Acme`. */
export function prettifyDomain(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  // Drop a leading mail/email/notifications-style subdomain and the TLD.
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function inferTier(events: Set<EventKind>, sig?: ServiceSignature): Tier {
  if (events.has("trial")) return "trial";
  if (events.has("receipt") || events.has("renewal")) return "paid";
  if (sig?.defaultTier) return sig.defaultTier;
  return events.has("signup") ? "free" : "unknown";
}

interface Group {
  sig?: ServiceSignature;
  domain: string;
  name: string;
  dates: number[];
  events: Set<EventKind>;
}

/**
 * Aggregate messages into services.
 * @param now epoch ms (passed in for testability / determinism).
 */
export function parseMessages(
  messages: RawMessage[],
  emailAddress: string,
  now: number,
): DetectedService[] {
  const groups = new Map<string, Group>();

  for (const msg of messages) {
    const { domain, name } = parseFrom(msg.from);
    if (!domain) continue;

    const sig = matchService(domain);
    const key = sig ? sig.id : domain;
    const event = classifyEvent(`${msg.subject} ${msg.snippet}`);

    let g = groups.get(key);
    if (!g) {
      g = {
        sig,
        domain,
        name: sig?.name ?? name ?? domain,
        dates: [],
        events: new Set<EventKind>(),
      };
      groups.set(key, g);
    }
    if (msg.date) g.dates.push(msg.date);
    g.events.add(event);
  }

  const services: DetectedService[] = [];

  for (const [key, g] of groups) {
    const meaningful =
      g.events.has("signup") ||
      g.events.has("trial") ||
      g.events.has("receipt") ||
      g.events.has("renewal");

    // Known services always shown; unknown senders only if they had a real
    // account signal (avoids listing every newsletter/no-reply domain).
    if (!g.sig && !meaningful) continue;

    const dates = g.dates.length ? g.dates : [now];
    const firstSeen = Math.min(...dates);
    const lastSeen = Math.max(...dates);

    services.push({
      key,
      id: `${emailAddress}:${key}`,
      name: g.sig?.name ?? prettifyDomain(g.domain),
      domain: g.domain,
      category: g.sig?.category ?? "other",
      tier: inferTier(g.events, g.sig),
      isTrial: g.events.has("trial"),
      isDormant: now - lastSeen > DORMANT_DAYS * DAY_MS,
      firstSeen,
      lastSeen,
      messageCount: g.dates.length,
      events: [...g.events],
      emailAddress,
    });
  }

  // Most recently active first.
  services.sort((a, b) => b.lastSeen - a.lastSeen);
  return services;
}
