/** Display metadata for tiers and categories — single source of truth for the UI. */
import type { ServiceCategory, Tier } from "./types";

export interface TierMeta {
  label: string;
  /** CSS variable carrying the validated color. */
  colorVar: string;
  /** Icon glyph so identity is never color-alone (esp. the warning tier). */
  icon: string;
  /** One-line meaning for tooltips/legends. */
  hint: string;
}

export const TIER_META: Record<Tier, TierMeta> = {
  free: {
    label: "Free tier",
    colorVar: "var(--tier-free)",
    icon: "○",
    hint: "Signed up, no billing signal seen",
  },
  trial: {
    label: "Trial",
    colorVar: "var(--tier-trial)",
    icon: "⏳",
    hint: "On a trial — may convert to paid",
  },
  paid: {
    label: "Paid",
    colorVar: "var(--tier-paid)",
    icon: "●",
    hint: "Receipts or renewals seen — you pay for this",
  },
  unknown: {
    label: "Unknown",
    colorVar: "var(--tier-unknown)",
    icon: "?",
    hint: "Not enough signal to classify",
  },
};

export const TIER_ORDER: Tier[] = ["trial", "paid", "free", "unknown"];

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  "dev-tool": "Dev tool",
  cloud: "Cloud",
  ai: "AI",
  database: "Database",
  auth: "Auth",
  payments: "Payments",
  email: "Email / comms",
  observability: "Observability",
  saas: "SaaS",
  media: "Media",
  social: "Social",
  other: "Other",
};

/** Days-since helper for "last seen" copy. */
export function daysSince(ts: number, now: number): number {
  return Math.floor((now - ts) / 86_400_000);
}

export function relativeDays(ts: number, now: number): string {
  const d = daysSince(ts, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
