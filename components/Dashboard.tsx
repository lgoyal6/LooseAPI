"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABEL, relativeDays, TIER_META, TIER_ORDER } from "@/lib/tiers";
import type { DetectedService, Tier } from "@/lib/types";
import { StatTile } from "./StatTile";
import { TierBadge } from "./TierBadge";

type SortKey = "recent" | "oldest" | "name";
type TierFilter = Tier | "all" | "attention";

/** Services worth acting on: trials (may convert) + dormant paid (paying, unused). */
function needsAttention(s: DetectedService): boolean {
  return s.tier === "trial" || (s.tier === "paid" && s.isDormant);
}

export function Dashboard({
  services,
  now,
}: {
  services: DetectedService[];
  now: number;
}) {
  const [filter, setFilter] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const byTier: Record<Tier, number> = { free: 0, trial: 0, paid: 0, unknown: 0 };
    let dormant = 0;
    let attention = 0;
    for (const s of services) {
      byTier[s.tier]++;
      if (s.isDormant) dormant++;
      if (needsAttention(s)) attention++;
    }
    return { byTier, dormant, attention };
  }, [services]);

  const visible = useMemo(() => {
    let rows = services;
    if (filter === "attention") rows = rows.filter(needsAttention);
    else if (filter !== "all") rows = rows.filter((s) => s.tier === filter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (s) => s.name.toLowerCase().includes(needle) || s.domain.includes(needle),
      );
    }
    const sorted = [...rows];
    if (sort === "recent") sorted.sort((a, b) => b.lastSeen - a.lastSeen);
    else if (sort === "oldest") sorted.sort((a, b) => a.lastSeen - b.lastSeen);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [services, filter, sort, q]);

  const filterButton = (key: TierFilter, label: string) => (
    <button
      onClick={() => setFilter(key)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        filter === key
          ? "border-transparent bg-foreground text-background"
          : "border-border-hair text-secondary hover:bg-foreground/[.04]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row — hero is the actionable count, not a fake dollar figure (v1) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          value={counts.attention}
          label="Need attention"
          sublabel="Trials + dormant paid"
          accentVar="var(--status-serious)"
          emphasis
        />
        <StatTile value={services.length} label="Services found" />
        <StatTile
          value={counts.byTier.trial}
          label="On a trial"
          accentVar="var(--tier-trial)"
        />
        <StatTile
          value={counts.byTier.paid}
          label="Paid"
          accentVar="var(--tier-paid)"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {filterButton("all", `All (${services.length})`)}
        {filterButton("attention", `Needs attention (${counts.attention})`)}
        {TIER_ORDER.map((t) =>
          counts.byTier[t] > 0
            ? filterButton(t, `${TIER_META[t].label} (${counts.byTier[t]})`)
            : null,
        )}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-32 rounded-full border border-border-hair bg-surface px-3 py-1 text-xs outline-none focus:border-foreground/30 sm:w-44"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-full border border-border-hair bg-surface px-2 py-1 text-xs outline-none"
          >
            <option value="recent">Most recent</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl border border-border-hair">
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">No services match.</p>
        ) : (
          <ul className="divide-y divide-border-hair">
            {visible.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 bg-surface px-4 py-3"
                style={{ opacity: s.isDormant ? 0.7 : 1 }}
              >
                <span
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border-hair text-xs font-semibold text-secondary"
                >
                  {s.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="truncate text-xs text-muted">{s.domain}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {CATEGORY_LABEL[s.category]} · seen {relativeDays(s.lastSeen, now)} ·{" "}
                    {s.messageCount} {s.messageCount === 1 ? "email" : "emails"}
                  </div>
                </div>
                <TierBadge tier={s.tier} dormant={s.isDormant} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
