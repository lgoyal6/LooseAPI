/**
 * Credit burndown — the one thing a general subscription tracker cannot show.
 *
 * Single series, so no legend: the title names it. Direct labels on the points
 * that carry meaning (first, last, and the projected zero) rather than a number
 * on every point. 2px line, 8px markers, recessive axes — per the mark specs.
 *
 * The dashed projection segment is the whole point: it is the line that would
 * have said "about a day left" on Aug 17.
 */

export interface BurndownPoint {
  date: string;
  cents: number;
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function Burndown({
  service,
  points,
  zeroAt,
}: {
  service: string;
  points: BurndownPoint[];
  zeroAt?: string | null;
}) {
  if (points.length < 2) return null;

  const W = 620;
  const H = 200;
  const PAD = { top: 24, right: 96, bottom: 32, left: 52 };

  const all = zeroAt ? [...points, { date: zeroAt, cents: 0 }] : points;
  const t = (d: string) => new Date(d).getTime();
  const t0 = t(all[0].date);
  const t1 = t(all[all.length - 1].date);
  const maxC = Math.max(...all.map((p) => p.cents));

  const x = (d: string) =>
    PAD.left + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (c: number) =>
    H - PAD.bottom - (c / Math.max(1, maxC)) * (H - PAD.top - PAD.bottom);

  const solid = points.map((p) => `${x(p.date)},${y(p.cents)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <figure className="viz-root card" style={{ margin: 0 }}>
      <figcaption className="card-title">
        {service} — credit balance
        <span className="card-sub">
          projected to zero at the observed burn rate
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${service} credit balance falling from ${fmt(points[0].cents)} to ${fmt(last.cents)}${zeroAt ? ", projected to reach zero" : ""}`}
      >
        {/* Recessive baseline only — no grid, the series is one line. */}
        <line
          x1={PAD.left}
          y1={H - PAD.bottom}
          x2={W - PAD.right}
          y2={H - PAD.bottom}
          className="axis"
        />

        {/* Projection to zero, dashed to mark it as inferred rather than observed. */}
        {zeroAt && (
          <line
            x1={x(last.date)}
            y1={y(last.cents)}
            x2={x(zeroAt)}
            y2={y(0)}
            className="series projection"
          />
        )}

        <polyline points={solid} className="series" fill="none" />

        {points.map((p) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.cents)} r={4.5} className="marker">
            <title>{`${p.date.slice(0, 10)}: ${fmt(p.cents)}`}</title>
          </circle>
        ))}

        {zeroAt && (
          <circle cx={x(zeroAt)} cy={y(0)} r={4.5} className="marker zero">
            <title>{`${zeroAt.slice(0, 10)}: $0 (projected)`}</title>
          </circle>
        )}

        {/* Selective direct labels: first, last, and the zero crossing. */}
        <text x={x(points[0].date)} y={y(points[0].cents) - 12} className="label mid">
          {fmt(points[0].cents)}
        </text>
        <text x={x(last.date)} y={y(last.cents) - 12} className="label mid">
          {fmt(last.cents)}
        </text>
        {zeroAt && (
          <text x={x(zeroAt) + 10} y={y(0) + 4} className="label">
            $0 · {zeroAt.slice(5, 10)}
          </text>
        )}

        <text x={PAD.left} y={H - 10} className="tick">
          {points[0].date.slice(5, 10)}
        </text>
        <text x={W - PAD.right} y={H - 10} className="tick end">
          {(zeroAt ?? last.date).slice(5, 10)}
        </text>
      </svg>

      {/* Table view — identity is never color- or shape-alone. */}
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{p.date.slice(0, 10)}</td>
                <td>{fmt(p.cents)}</td>
              </tr>
            ))}
            {zeroAt && (
              <tr>
                <td>{zeroAt.slice(0, 10)}</td>
                <td>$0 (projected)</td>
              </tr>
            )}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
