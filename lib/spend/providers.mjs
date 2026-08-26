/**
 * Optional live-balance adapters. Gmail tells you what already happened;
 * these tell you what is happening right now, between emails.
 *
 * Every adapter is skipped cleanly when its credential is absent, so the tool
 * degrades to Gmail-only rather than failing. Credentials come from
 * ~/.devspend/config.json under `providers`.
 *
 * The hosting adapters below are written against each vendor's documented API
 * but could not be executed here, because none of the tokens exist yet. They
 * report reachability first and a cost figure only where the response shape is
 * certain; a wrong guess therefore surfaces as a visible error on first use
 * rather than as a confident wrong number.
 *
 * What is deliberately NOT here, because no API exists (verified against
 * platform.claude.com/docs 2026-08-26):
 *
 *   - Claude Pro/Max subscription: consumer plans expose no usage or billing
 *     API. Receipt email is the only source.
 *   - ChatGPT Plus / Codex subscription: same.
 *
 * And Anthropic's own cost API is org-only: "The Admin API is unavailable for
 * individual accounts." An individual has to convert to an organization in
 * Console -> Settings -> Organization before `sk-ant-admin01-...` can exist.
 */

const ADAPTERS = [
  {
    id: "anthropic",
    name: "Anthropic API",
    /** Needs an org admin key, NOT a normal sk-ant-api key. */
    credential: (p) => p.anthropicAdminKey,
    hint: "org-only; requires sk-ant-admin01-... from Console > Settings > Organization",
    async fetch(key) {
      const end = new Date();
      const start = new Date(end - 30 * 86400000);
      const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
      url.searchParams.set("starting_at", start.toISOString().slice(0, 19) + "Z");
      url.searchParams.set("ending_at", end.toISOString().slice(0, 19) + "Z");
      const res = await fetch(url, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "user-agent": "devspend/0.1.0",
        },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      // Amounts are decimal strings in cents.
      let cents = 0;
      for (const bucket of body.data || []) {
        for (const item of bucket.results || []) cents += Math.round(Number(item.amount || 0));
      }
      return { periodDays: 30, cents };
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    credential: (p) => p.cloudflareToken && p.cloudflareAccountId && p,
    hint: "cloudflareToken + cloudflareAccountId",
    async fetch(p) {
      // Cloudflare exposes no direct billing endpoint on the free plan; the
      // account-level subscriptions call is the closest honest signal.
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${p.cloudflareAccountId}/subscriptions`,
        { headers: { authorization: `Bearer ${p.cloudflareToken}` } },
      );
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      const cents = Math.round(
        (body.result || []).reduce((s, sub) => s + Number(sub.price || 0), 0) * 100,
      );
      return { periodDays: 30, cents };
    },
  },
  {
    id: "railway",
    name: "Railway",
    credential: (p) => p.railwayToken,
    hint: "railwayToken (Account token from railway.com/account/tokens)",
    async fetch(token) {
      const q = `query { me { id } }`;
      const res = await fetch("https://backboard.railway.com/graphql/v2", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      if (body.errors) throw new Error(body.errors[0]?.message ?? "graphql error");
      // Usage lives behind a per-workspace query that differs by plan; surface
      // reachability now and let the shape be pinned when a token exists.
      return { periodDays: 30, cents: null, note: "connected; usage query needs a workspace id" };
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    credential: (p) => p.supabaseToken,
    hint: "supabaseToken (PAT from supabase.com/dashboard/account/tokens)",
    async fetch(token) {
      const res = await fetch("https://api.supabase.com/v1/projects", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const projects = await res.json();
      return { periodDays: 30, cents: null, note: `${projects.length} project(s)` };
    },
  },
  {
    id: "render",
    name: "Render",
    credential: (p) => p.renderToken,
    hint: "renderToken (API key from dashboard.render.com/u/settings)",
    async fetch(token) {
      const res = await fetch("https://api.render.com/v1/services?limit=50", {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const list = await res.json();
      return { periodDays: 30, cents: null, note: `${list.length} service(s)` };
    },
  },
  {
    id: "neon",
    name: "Neon",
    credential: (p) => p.neonToken,
    hint: "neonToken (API key from console.neon.tech/app/settings/api-keys)",
    async fetch(token) {
      const res = await fetch("https://console.neon.tech/api/v2/projects", {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      const n = (body.projects ?? []).length;
      return { periodDays: 30, cents: null, note: `${n} project(s)` };
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    credential: (p) => p.vercelToken,
    hint: "vercelToken",
    async fetch(token) {
      const res = await fetch("https://api.vercel.com/v2/user", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      const plan = body.user?.billing?.plan ?? "unknown";
      return { periodDays: 30, cents: plan === "hobby" ? 0 : null, note: `plan=${plan}` };
    },
  },
];

/**
 * @returns {Promise<Array<{id,name,status,cents?,note?,error?}>>}
 */
export async function pollProviders(config = {}) {
  const p = config.providers || {};
  const out = [];
  for (const a of ADAPTERS) {
    const cred = a.credential(p);
    if (!cred) {
      out.push({ id: a.id, name: a.name, status: "skipped", note: a.hint });
      continue;
    }
    try {
      const r = await a.fetch(cred);
      out.push({ id: a.id, name: a.name, status: "ok", ...r });
    } catch (err) {
      out.push({ id: a.id, name: a.name, status: "error", error: String(err.message || err) });
    }
  }
  return out;
}

/** Surfaces that can never be polled, so the report can say so explicitly. */
export const NO_API = [
  { name: "Claude Pro/Max subscription", reason: "consumer plans expose no billing API" },
  { name: "ChatGPT Plus / Codex subscription", reason: "consumer plans expose no billing API" },
];
