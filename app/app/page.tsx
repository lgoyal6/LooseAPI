"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { FootprintGraph } from "@/components/FootprintGraph";
import { GOOGLE_CLIENT_ID } from "@/lib/config";
import { loadServices, mostRecentScan, wipeAll, type ScanMeta } from "@/lib/db";
import { runScan, type ScanProgress } from "@/lib/scan";
import { relativeDays } from "@/lib/tiers";
import type { DetectedService } from "@/lib/types";

type View = "dashboard" | "graph";

const PHASE_TEXT: Record<ScanProgress["phase"], string> = {
  connecting: "Connecting to Google…",
  listing: "Finding relevant emails…",
  fetching: "Reading email headers…",
  parsing: "Mapping your services…",
  saving: "Saving locally…",
};

export default function AppPage() {
  const [now] = useState(() => Date.now());
  const [services, setServices] = useState<DetectedService[]>([]);
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Restore the most recent local scan on load — no network, no re-auth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recent = await mostRecentScan();
        if (recent && !cancelled) {
          setMeta(recent);
          setServices(await loadServices(recent.emailAddress));
        }
      } catch {
        /* first run — nothing stored */
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scan = useCallback(async () => {
    setError(null);
    setProgress({ phase: "connecting" });
    try {
      const result = await runScan(setProgress);
      setServices(result.services);
      setMeta({
        emailAddress: result.emailAddress,
        scannedAt: result.scannedAt,
        messageCount: result.scanned,
        serviceCount: result.services.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setProgress(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await wipeAll();
    setServices([]);
    setMeta(null);
    setError(null);
  }, []);

  const scanning = progress !== null;
  const hasData = services.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-8">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Loose<span className="text-tier-paid">Api</span>
        </Link>
        <div className="flex items-center gap-2">
          {meta && (
            <span className="hidden text-xs text-muted sm:inline">{meta.emailAddress}</span>
          )}
          <button
            onClick={scan}
            disabled={scanning}
            className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : hasData ? "Rescan" : "Connect Gmail"}
          </button>
          {hasData && (
            <button
              onClick={disconnect}
              disabled={scanning}
              className="rounded-full border border-border-hair px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-foreground/[.04] disabled:opacity-50"
            >
              Wipe
            </button>
          )}
        </div>
      </header>

      {/* missing config */}
      {!GOOGLE_CLIENT_ID && (
        <div className="rounded-xl border border-status-serious/40 bg-status-serious/[.06] p-4 text-sm">
          <p className="font-medium">Google OAuth isn&apos;t configured yet.</p>
          <p className="mt-1 text-secondary">
            Add <code className="rounded bg-foreground/10 px-1">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>{" "}
            to <code className="rounded bg-foreground/10 px-1">.env.local</code>. See{" "}
            <code className="rounded bg-foreground/10 px-1">SETUP.md</code> for the 5-minute setup.
          </p>
        </div>
      )}

      {/* scan progress */}
      {progress && (
        <div className="rounded-xl border border-border-hair bg-surface p-4">
          <div className="flex items-center justify-between text-sm">
            <span>{PHASE_TEXT[progress.phase]}</span>
            {progress.total ? (
              <span className="tabular-nums text-muted">
                {progress.done ?? 0} / {progress.total}
              </span>
            ) : null}
          </div>
          {progress.total ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-tier-paid transition-all"
                style={{ width: `${((progress.done ?? 0) / progress.total) * 100}%` }}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* error */}
      {error && (
        <div className="rounded-xl border border-status-critical/40 bg-status-critical/[.06] p-4 text-sm">
          <span className="font-medium text-status-critical">Couldn&apos;t scan.</span>{" "}
          <span className="text-secondary">{error}</span>
        </div>
      )}

      {/* body */}
      {hasData ? (
        <>
          <div className="flex items-center justify-between">
            <div className="inline-flex rounded-full border border-border-hair p-0.5 text-sm">
              {(["dashboard", "graph"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-full px-4 py-1 capitalize transition-colors ${
                    view === v ? "bg-foreground text-background" : "text-secondary"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {meta && (
              <span className="text-xs text-muted">
                Scanned {relativeDays(meta.scannedAt, now)} · {meta.messageCount} emails
              </span>
            )}
          </div>

          {view === "dashboard" ? (
            <Dashboard services={services} now={now} />
          ) : (
            <FootprintGraph
              services={services}
              emailAddress={meta?.emailAddress ?? ""}
              now={now}
            />
          )}

          <p className="text-center text-xs text-muted">
            🔒 Everything above was computed in your browser. Your email never left this device.
          </p>
        </>
      ) : (
        restored &&
        !scanning && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-hair py-20 text-center">
            <p className="text-lg font-medium">See what your email is tied to</p>
            <p className="max-w-sm text-sm text-muted">
              Connect Gmail and LooseApi maps every dev tool, free tier, and trial your
              address signed up for — all processed locally.
            </p>
          </div>
        )
      )}
    </div>
  );
}
