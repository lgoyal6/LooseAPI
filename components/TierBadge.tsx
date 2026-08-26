import { TIER_META } from "@/lib/tiers";
import type { Tier } from "@/lib/types";

/** A small colored dot + label. Identity is icon+label+color, never color alone. */
export function TierBadge({ tier, dormant }: { tier: Tier; dormant?: boolean }) {
  const meta = TIER_META[tier];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: meta.colorVar }}
      />
      <span>{meta.label}</span>
      {dormant && (
        <span className="rounded-full border border-border-hair px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
          dormant
        </span>
      )}
    </span>
  );
}
