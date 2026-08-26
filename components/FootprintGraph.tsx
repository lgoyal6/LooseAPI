"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABEL, relativeDays, TIER_META } from "@/lib/tiers";
import type { DetectedService, Tier } from "@/lib/types";
import { TierBadge } from "./TierBadge";

const VW = 800;
const VH = 600;
const CX = VW / 2;
const CY = VH / 2;

interface Placed extends DetectedService {
  x: number;
  y: number;
  r: number;
}

/**
 * Hub-and-spoke footprint. The email is the hub; each detected service is a
 * spoke. Color encodes tier (validated palette); dormancy is a second channel
 * (dimmed + dashed) so it never relies on color alone.
 */
export function FootprintGraph({
  services,
  emailAddress,
  now,
}: {
  services: DetectedService[];
  emailAddress: string;
  now: number;
}) {
  const [hover, setHover] = useState<Placed | null>(null);

  const placed = useMemo<Placed[]>(() => {
    // Cluster colors: order by tier, then most-recent, so like hues sit together.
    const tierRank: Record<Tier, number> = { trial: 0, paid: 1, free: 2, unknown: 3 };
    const sorted = [...services].sort(
      (a, b) => tierRank[a.tier] - tierRank[b.tier] || b.lastSeen - a.lastSeen,
    );
    const n = sorted.length || 1;
    const radius = Math.min(250, 130 + n * 2.2);
    return sorted.map((s, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return {
        ...s,
        x: CX + radius * Math.cos(angle),
        y: CY + radius * Math.sin(angle),
        r: 5 + Math.min(9, Math.log2(s.messageCount + 1) * 2.2),
      };
    });
  }, [services]);

  const presentTiers = useMemo(
    () => [...new Set(services.map((s) => s.tier))],
    [services],
  );

  const local = emailAddress.split("@")[0] || "you";

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border-hair bg-surface">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="block w-full"
        style={{ aspectRatio: `${VW} / ${VH}` }}
        role="img"
        aria-label={`Footprint graph of ${services.length} services connected to ${emailAddress}`}
      >
        {/* spokes */}
        {placed.map((s) => (
          <line
            key={`l-${s.id}`}
            x1={CX}
            y1={CY}
            x2={s.x}
            y2={s.y}
            stroke="var(--gridline)"
            strokeWidth={1.5}
            strokeDasharray={s.isDormant ? "3 4" : undefined}
            opacity={hover && hover.id !== s.id ? 0.25 : 0.7}
          />
        ))}

        {/* service nodes */}
        {placed.map((s) => {
          const dim = hover && hover.id !== s.id;
          return (
            <circle
              key={`c-${s.id}`}
              cx={s.x}
              cy={s.y}
              r={hover?.id === s.id ? s.r + 2 : s.r}
              fill={TIER_META[s.tier].colorVar}
              stroke="var(--surface-1)"
              strokeWidth={2}
              strokeDasharray={s.isDormant ? "2 2" : undefined}
              opacity={dim ? 0.35 : s.isDormant ? 0.6 : 1}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover((h) => (h?.id === s.id ? null : h))}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        {/* hub */}
        <circle cx={CX} cy={CY} r={30} fill="var(--surface-1)" stroke="var(--border-hair)" strokeWidth={2} />
        <text
          x={CX}
          y={CY}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground"
          fontSize={13}
          fontWeight={600}
        >
          {local.length > 8 ? local.slice(0, 7) + "…" : local}
        </text>
      </svg>

      {/* hover tooltip, positioned by node % of the viewBox */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border-hair bg-surface px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(hover.x / VW) * 100}%`,
            top: `calc(${(hover.y / VH) * 100}% - 12px)`,
          }}
        >
          <div className="font-medium">{hover.name}</div>
          <div className="mb-1 text-muted">{CATEGORY_LABEL[hover.category]}</div>
          <TierBadge tier={hover.tier} dormant={hover.isDormant} />
          <div className="mt-1 text-muted">
            seen {relativeDays(hover.lastSeen, now)} · {hover.messageCount}{" "}
            {hover.messageCount === 1 ? "email" : "emails"}
          </div>
        </div>
      )}

      {/* legend — identity is never color-alone */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-hair px-4 py-2">
        {presentTiers.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: TIER_META[t].colorVar }}
            />
            {TIER_META[t].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-muted" />
          dormant (dimmed)
        </span>
      </div>
    </div>
  );
}
