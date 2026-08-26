import Link from "next/link";

const STEPS = [
  {
    title: "Connect Gmail",
    body: "Read-only, via Google's own consent screen. Revoke anytime.",
  },
  {
    title: "We map your footprint",
    body: "Signup, receipt, and trial emails become a graph of every service you use.",
  },
  {
    title: "See what's leaking money",
    body: "Forgotten trials about to charge, dormant accounts, free tiers you abandoned.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold tracking-tight">
          Loose<span className="text-tier-paid">Api</span>
        </span>
        <Link
          href="/app"
          className="rounded-full border border-border-hair px-4 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-foreground/[.04]"
        >
          Open app
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 py-16 text-center">
        <div className="flex flex-col items-center gap-5">
          <span className="rounded-full border border-border-hair px-3 py-1 text-xs font-medium text-secondary">
            🔒 Local-first · your inbox never leaves your device
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Every free tier and trial your email forgot about.
          </h1>
          <p className="max-w-xl text-lg text-secondary">
            LooseApi scans your Gmail — right in your browser — to map every dev tool,
            subscription, and free-tier account you&apos;ve signed up for, and flags the
            ones quietly about to charge you.
          </p>
          <Link
            href="/app"
            className="mt-2 rounded-full bg-foreground px-6 py-3 text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            Scan my inbox →
          </Link>
        </div>

        <ol className="grid w-full gap-4 text-left sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rounded-xl border border-border-hair bg-surface p-4"
            >
              <span className="text-sm font-semibold text-tier-paid">0{i + 1}</span>
              <h3 className="mt-1 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="border-t border-border-hair py-6 text-center text-xs text-muted">
        Processed entirely on your device · read-only Gmail access · no inbox data stored on our servers
      </footer>
    </div>
  );
}
