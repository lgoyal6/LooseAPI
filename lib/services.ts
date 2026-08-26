import type { EventKind, ServiceCategory, Tier } from "./types";

/**
 * A known service and the sender domains that map to it. Matching is done by
 * exact domain or registrable-suffix (`endsWith('.' + d)`), so `email.vercel.com`
 * still maps to `vercel.com`.
 *
 * This dictionary is the product's moat — grow it aggressively. `defaultTier`
 * is the assumption when we see a signup but no billing signal (most dev tools
 * start on a free tier).
 */
export interface ServiceSignature {
  id: string;
  name: string;
  category: ServiceCategory;
  domains: string[];
  defaultTier?: Tier;
}

export const SERVICES: ServiceSignature[] = [
  // Hosting / platforms
  { id: "vercel", name: "Vercel", category: "dev-tool", domains: ["vercel.com"], defaultTier: "free" },
  { id: "netlify", name: "Netlify", category: "dev-tool", domains: ["netlify.com"], defaultTier: "free" },
  { id: "render", name: "Render", category: "dev-tool", domains: ["render.com"], defaultTier: "free" },
  { id: "railway", name: "Railway", category: "dev-tool", domains: ["railway.app", "railway.com"], defaultTier: "free" },
  { id: "fly", name: "Fly.io", category: "dev-tool", domains: ["fly.io"], defaultTier: "free" },
  { id: "heroku", name: "Heroku", category: "dev-tool", domains: ["heroku.com"], defaultTier: "free" },
  { id: "digitalocean", name: "DigitalOcean", category: "cloud", domains: ["digitalocean.com"], defaultTier: "paid" },
  { id: "cloudflare", name: "Cloudflare", category: "cloud", domains: ["cloudflare.com"], defaultTier: "free" },

  // Hyperscalers
  { id: "aws", name: "Amazon Web Services", category: "cloud", domains: ["amazonaws.com", "aws.amazon.com"], defaultTier: "paid" },
  { id: "gcp", name: "Google Cloud", category: "cloud", domains: ["cloud.google.com"], defaultTier: "paid" },
  { id: "azure", name: "Microsoft Azure", category: "cloud", domains: ["azure.com", "azure.microsoft.com"], defaultTier: "paid" },
  { id: "oracle", name: "Oracle Cloud", category: "cloud", domains: ["oracle.com"], defaultTier: "free" },

  // AI
  { id: "openai", name: "OpenAI", category: "ai", domains: ["openai.com"], defaultTier: "paid" },
  { id: "anthropic", name: "Anthropic", category: "ai", domains: ["anthropic.com"], defaultTier: "paid" },
  { id: "huggingface", name: "Hugging Face", category: "ai", domains: ["huggingface.co"], defaultTier: "free" },
  { id: "replicate", name: "Replicate", category: "ai", domains: ["replicate.com"], defaultTier: "free" },
  { id: "modal", name: "Modal", category: "ai", domains: ["modal.com"], defaultTier: "free" },
  { id: "groq", name: "Groq", category: "ai", domains: ["groq.com"], defaultTier: "free" },
  { id: "pinecone", name: "Pinecone", category: "ai", domains: ["pinecone.io"], defaultTier: "free" },
  { id: "langchain", name: "LangChain / LangSmith", category: "ai", domains: ["langchain.com"], defaultTier: "free" },

  // Databases
  { id: "supabase", name: "Supabase", category: "database", domains: ["supabase.io", "supabase.com"], defaultTier: "free" },
  { id: "planetscale", name: "PlanetScale", category: "database", domains: ["planetscale.com"], defaultTier: "free" },
  { id: "neon", name: "Neon", category: "database", domains: ["neon.tech"], defaultTier: "free" },
  { id: "mongodb", name: "MongoDB Atlas", category: "database", domains: ["mongodb.com"], defaultTier: "free" },
  { id: "turso", name: "Turso", category: "database", domains: ["turso.tech"], defaultTier: "free" },
  { id: "upstash", name: "Upstash", category: "database", domains: ["upstash.com"], defaultTier: "free" },
  { id: "redis", name: "Redis", category: "database", domains: ["redis.com", "redis.io"], defaultTier: "free" },
  { id: "prisma", name: "Prisma", category: "database", domains: ["prisma.io"], defaultTier: "free" },
  { id: "firebase", name: "Firebase", category: "database", domains: ["firebase.google.com"], defaultTier: "free" },

  // Auth
  { id: "clerk", name: "Clerk", category: "auth", domains: ["clerk.com", "clerk.dev"], defaultTier: "free" },
  { id: "auth0", name: "Auth0", category: "auth", domains: ["auth0.com"], defaultTier: "free" },

  // Payments / email / comms
  { id: "stripe", name: "Stripe", category: "payments", domains: ["stripe.com"], defaultTier: "free" },
  { id: "twilio", name: "Twilio", category: "email", domains: ["twilio.com"], defaultTier: "paid" },
  { id: "sendgrid", name: "SendGrid", category: "email", domains: ["sendgrid.com", "sendgrid.net"], defaultTier: "free" },
  { id: "resend", name: "Resend", category: "email", domains: ["resend.com"], defaultTier: "free" },
  { id: "postmark", name: "Postmark", category: "email", domains: ["postmarkapp.com"], defaultTier: "paid" },

  // Observability
  { id: "sentry", name: "Sentry", category: "observability", domains: ["sentry.io"], defaultTier: "free" },
  { id: "datadog", name: "Datadog", category: "observability", domains: ["datadoghq.com"], defaultTier: "paid" },
  { id: "posthog", name: "PostHog", category: "observability", domains: ["posthog.com"], defaultTier: "free" },

  // Dev tools / SaaS
  { id: "github", name: "GitHub", category: "dev-tool", domains: ["github.com"], defaultTier: "free" },
  { id: "gitlab", name: "GitLab", category: "dev-tool", domains: ["gitlab.com"], defaultTier: "free" },
  { id: "npm", name: "npm", category: "dev-tool", domains: ["npmjs.com"], defaultTier: "free" },
  { id: "docker", name: "Docker", category: "dev-tool", domains: ["docker.com"], defaultTier: "free" },
  { id: "postman", name: "Postman", category: "dev-tool", domains: ["postman.com"], defaultTier: "free" },
  { id: "expo", name: "Expo", category: "dev-tool", domains: ["expo.dev"], defaultTier: "free" },
  { id: "algolia", name: "Algolia", category: "dev-tool", domains: ["algolia.com"], defaultTier: "free" },
  { id: "retool", name: "Retool", category: "dev-tool", domains: ["retool.com"], defaultTier: "free" },
  { id: "linear", name: "Linear", category: "saas", domains: ["linear.app"], defaultTier: "free" },
  { id: "notion", name: "Notion", category: "saas", domains: ["notion.so", "notion.com"], defaultTier: "free" },
  { id: "figma", name: "Figma", category: "saas", domains: ["figma.com"], defaultTier: "free" },
  { id: "airtable", name: "Airtable", category: "saas", domains: ["airtable.com"], defaultTier: "free" },
  { id: "slack", name: "Slack", category: "saas", domains: ["slack.com"], defaultTier: "free" },
];

/** Ordered subject/snippet rules; first match wins. Case-insensitive. */
export const EVENT_RULES: { kind: EventKind; test: RegExp }[] = [
  // Billing signals first — most valuable and most specific.
  { kind: "trial", test: /\b(free trial|trial (ends|ending|expir|will end)|days? (left|remaining) (in|of) your|your trial|start(ing)? your (free )?trial)\b/i },
  { kind: "renewal", test: /\b(renew|auto-?renew|subscription (will|is set to)|upcoming (charge|payment|invoice)|your plan renews)\b/i },
  { kind: "receipt", test: /\b(receipt|invoice|payment (received|confirmation|successful)|you(?:'|’)?ve been charged|billed|order confirmation|thanks for your (payment|purchase|order))\b/i },
  // Onboarding.
  { kind: "signup", test: /\b(welcome to|verify your (email|account)|confirm your (email|account)|activate your account|account (created|activated)|get started|complete your (sign ?up|registration)|thanks for signing up)\b/i },
  // Low-value.
  { kind: "security", test: /\b(password|security alert|new (sign-?in|login)|verify it'?s you|two-?factor|2fa|suspicious)\b/i },
  { kind: "marketing", test: /\b(newsletter|unsubscribe|% off|sale|new features?|product update|weekly digest|webinar|tips)\b/i },
];

/** Match a sender domain to a known service, if any. */
export function matchService(domain: string): ServiceSignature | undefined {
  return SERVICES.find((s) =>
    s.domains.some((d) => domain === d || domain.endsWith("." + d)),
  );
}

/** Classify an email into an event kind from its subject + snippet text. */
export function classifyEvent(text: string): EventKind {
  for (const rule of EVENT_RULES) if (rule.test.test(text)) return rule.kind;
  return "other";
}
