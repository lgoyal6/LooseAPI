/** A KPI tile: big value + label, optional accent color and sub-line. */
export function StatTile({
  value,
  label,
  sublabel,
  accentVar,
  emphasis,
}: {
  value: number | string;
  label: string;
  sublabel?: string;
  accentVar?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border border-border-hair bg-surface p-4 ${
        emphasis ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-baseline gap-2">
        {accentVar && (
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: accentVar }}
          />
        )}
        <span
          className={`font-semibold tabular-nums leading-none ${
            emphasis ? "text-4xl" : "text-3xl"
          }`}
          style={accentVar ? { color: accentVar } : undefined}
        >
          {value}
        </span>
      </div>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {sublabel && <span className="text-xs text-muted">{sublabel}</span>}
    </div>
  );
}
