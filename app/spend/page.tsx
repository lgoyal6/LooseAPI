/**
 * Spend dashboard. Reads the snapshot the CLI writes, so the dashboard and the
 * Discord digest are the same numbers from the same parser — there is no second
 * implementation to drift.
 */
import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Burndown, type BurndownPoint } from "./burndown";
import "./spend.css";

interface SpendEvent {
  id: string;
  date: string;
  serviceId: string;
  service: string;
  scope: string;
  via: string | null;
  kind: string;
  severity: number;
  amountCents: number | null;
  creditsRemainingCents: number | null;
  subject: string;
  unread: boolean;
  trashed: boolean;
}

interface Alert {
  kind: string;
  severity: number;
  service: string;
  message: string;
  evidence: string[];
}

interface Snapshot {
  generatedAt: string;
  source: string;
  messageCount: number;
  hiddenOutOfScope: number;
  monthlyCents: number;
  events: SpendEvent[];
  alerts: Alert[];
  providers: { id: string; name: string; status: string; cents?: number; note?: string; error?: string }[];
  noApi: { name: string; reason: string }[];
}

const fmt = (c: number | null | undefined) =>
  c == null ? "—" : `$${(c / 100).toFixed(2)}`;

/** critical / warning / good, each paired with an icon and a word — never color alone. */
const STATUS = {
  3: { cls: "critical", icon: "▲", word: "Critical" },
  2: { cls: "warning", icon: "●", word: "Watch" },
} as const;

async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    return JSON.parse(
      await readFile(join(homedir(), ".devspend", "snapshot.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Balance readings per service, plus a linear projection to zero. */
function burndowns(events: SpendEvent[]) {
  const byService = new Map<string, BurndownPoint[]>();
  for (const e of events) {
    if (e.creditsRemainingCents == null) continue;
    const list = byService.get(e.service) ?? [];
    list.push({ date: e.date, cents: e.creditsRemainingCents });
    byService.set(e.service, list);
  }

  return [...byService.entries()]
    .map(([service, pts]) => {
      const points = pts.sort((a, b) => +new Date(a.date) - +new Date(b.date));
      if (points.length < 2) return null;
      const a = points[points.length - 2];
      const b = points[points.length - 1];
      const days = (+new Date(b.date) - +new Date(a.date)) / 86400000;
      const perDay = days > 0 ? (a.cents - b.cents) / days : 0;
      const zeroAt =
        perDay > 0
          ? new Date(+new Date(b.date) + (b.cents / perDay) * 86400000).toISOString()
          : null;
      return { service, points, zeroAt };
    })
    .filter((x): x is { service: string; points: BurndownPoint[]; zeroAt: string | null } => x !== null);
}

export default async function SpendPage() {
  await connection(); // snapshot changes between requests; render per request

  const snap = await loadSnapshot();

  if (!snap) {
    return (
      <main className="spend">
        <h1>Spend</h1>
        <p className="empty">
          No snapshot yet. Run <code>node bin/spend.mjs</code> to generate{" "}
          <code>~/.devspend/snapshot.json</code>.
        </p>
      </main>
    );
  }

  const charges = snap.events.filter((e) => e.kind === "charge");
  const unreadMoney = snap.events.filter((e) => e.severity >= 2 && e.unread).length;
  const services = new Set(snap.events.map((e) => e.serviceId)).size;

  // Per-service totals, biggest first.
  const perService = [...
    charges.reduce((m, e) => {
      const cur = m.get(e.service) ?? { service: e.service, cents: 0, count: 0, via: e.via };
      cur.cents += e.amountCents ?? 0;
      cur.count += 1;
      m.set(e.service, cur);
      return m;
    }, new Map<string, { service: string; cents: number; count: number; via: string | null }>())
      .values(),
  ].sort((a, b) => b.cents - a.cents);

  return (
    <main className="spend">
      <header className="head">
        <h1>Spend</h1>
        <p className="meta">
          {snap.messageCount} messages scanned via {snap.source} ·{" "}
          {new Date(snap.generatedAt).toLocaleString()}
          {snap.hiddenOutOfScope > 0 && ` · ${snap.hiddenOutOfScope} out of scope`}
        </p>
      </header>

      {/* Hero numbers, not charts — a single value's job is to be read, not plotted. */}
      <section className="tiles">
        <div className="tile">
          <span className="tile-label">Monthly recurring</span>
          <span className="tile-value">{fmt(snap.monthlyCents)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Active alerts</span>
          <span className={`tile-value ${snap.alerts.length ? "is-critical" : ""}`}>
            {snap.alerts.length}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Unread money mail</span>
          <span className={`tile-value ${unreadMoney ? "is-warning" : ""}`}>
            {unreadMoney}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Services seen</span>
          <span className="tile-value">{services}</span>
        </div>
      </section>

      {snap.alerts.length > 0 && (
        <section>
          <h2>Alerts</h2>
          <ul className="alerts">
            {snap.alerts.map((a, i) => {
              const s = STATUS[a.severity as 2 | 3] ?? STATUS[2];
              return (
                <li key={`${a.kind}-${i}`} className={`alert ${s.cls}`}>
                  <span className="alert-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  <span className="alert-word">{s.word}</span>
                  <span className="alert-msg">{a.message}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {burndowns(snap.events).map((b) => (
        <section key={b.service}>
          <Burndown service={b.service} points={b.points} zeroAt={b.zeroAt} />
        </section>
      ))}

      <section>
        <h2>By service</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Service</th>
              <th className="num">Charges</th>
              <th className="num">Total</th>
              <th>Billed through</th>
            </tr>
          </thead>
          <tbody>
            {perService.map((r) => (
              <tr key={r.service}>
                <td>{r.service}</td>
                <td className="num">{r.count}</td>
                <td className="num">{r.cents ? fmt(r.cents) : "—"}</td>
                <td className="muted">{r.via ?? "direct"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="two-up">
        <div>
          <h2>Live balances</h2>
          <ul className="plain">
            {snap.providers.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>{" "}
                {p.status === "ok" ? (
                  <span>{fmt(p.cents)}</span>
                ) : (
                  <span className="muted">
                    {p.status === "error" ? `error: ${p.error}` : `not configured`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>No API exists</h2>
          <ul className="plain">
            {snap.noApi.map((n) => (
              <li key={n.name}>
                <strong>{n.name}</strong>{" "}
                <span className="muted">{n.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2>Timeline</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th>Event</th>
              <th className="num">Amount</th>
              <th className="num">Balance</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {snap.events.map((e) => (
              <tr key={e.id}>
                <td>{e.date.slice(0, 10)}</td>
                <td>{e.service}</td>
                <td className="muted">{e.kind.replace(/_/g, " ")}</td>
                <td className="num">{fmt(e.amountCents)}</td>
                <td className="num">{fmt(e.creditsRemainingCents)}</td>
                <td className="muted">
                  {e.unread ? (e.trashed ? "unread, trashed" : "unread") : "read"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
