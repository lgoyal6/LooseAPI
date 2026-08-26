/**
 * API key registry.
 *
 * The split that makes this safe to open-source: the **secret** lives in the
 * macOS Keychain and nothing else; the **metadata** lives in a plain JSON file
 * outside the repo. Losing the JSON leaks a provider name and four characters.
 * There is no code path that writes a secret to disk, and no code path that
 * sends one anywhere.
 *
 * The dashboard renders metadata only. Revealing a secret is an explicit
 * terminal action (`spend keys reveal <id>`), never a page render — a browser
 * page ends up in history, screenshots, and screen shares, and a key that has
 * been shoulder-surfed is as burned as one that was committed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const DIR = join(homedir(), ".devspend");
const REGISTRY = join(DIR, "keys.json");

/** Keychain service name. Namespaced so it never collides with other tools. */
const svc = (id) => `devspend-key:${id}`;

async function readRegistry() {
  try {
    return JSON.parse(await readFile(REGISTRY, "utf8"));
  } catch {
    return { keys: [] };
  }
}

async function writeRegistry(reg) {
  await mkdir(DIR, { recursive: true });
  await writeFile(REGISTRY, JSON.stringify(reg, null, 2), { mode: 0o600 });
}

/**
 * Store a secret in the Keychain and record only non-secret metadata.
 *
 * @param {object} o
 * @param {string} o.id          stable slug, e.g. "anthropic-personal"
 * @param {string} o.provider    display name, e.g. "Anthropic"
 * @param {string} o.secret      the key itself — Keychain only, never returned
 * @param {number} [o.freeLimit] free allowance in cents, if the plan has one
 * @param {string} [o.note]      what it is for
 */
export async function addKey({ id, provider, secret, freeLimit = null, note = "" }) {
  if (!id || !provider || !secret) throw new Error("id, provider and secret are required");

  // -U updates in place if it already exists. -w takes the value on argv, which
  // is visible in `ps` for the instant it runs; the CLI reads secrets from stdin
  // and passes them here rather than accepting them as shell arguments.
  await exec("security", [
    "add-generic-password",
    "-s", svc(id),
    "-a", provider,
    "-w", secret,
    "-U",
    "-D", "devspend api key",
    "-j", note || `devspend: ${provider}`,
  ]);

  const reg = await readRegistry();
  const entry = {
    id,
    provider,
    note,
    last4: secret.slice(-4),
    length: secret.length,
    freeLimitCents: freeLimit,
    addedAt: new Date().toISOString(),
  };
  reg.keys = [...reg.keys.filter((k) => k.id !== id), entry].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
  await writeRegistry(reg);
  return entry;
}

/** Metadata for every key. Never includes a secret. */
export async function listKeys() {
  const reg = await readRegistry();
  const out = [];
  for (const k of reg.keys) {
    out.push({ ...k, inKeychain: await hasSecret(k.id) });
  }
  return out;
}

async function hasSecret(id) {
  try {
    await exec("security", ["find-generic-password", "-s", svc(id)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a secret back. Deliberately the only function that returns one, so the
 * blast radius of a mistake is a single call site you can grep for.
 */
export async function revealKey(id) {
  const { stdout } = await exec("security", ["find-generic-password", "-s", svc(id), "-w"]);
  return stdout.trim();
}

/** Remove from both Keychain and registry. */
export async function removeKey(id) {
  try {
    await exec("security", ["delete-generic-password", "-s", svc(id)]);
  } catch {
    /* already gone from the Keychain; still drop the metadata */
  }
  const reg = await readRegistry();
  reg.keys = reg.keys.filter((k) => k.id !== id);
  await writeRegistry(reg);
}

/**
 * Attach observed spend to each key.
 *
 * Per-key attribution exists only where a provider reports it — Anthropic's
 * usage API groups by `api_key_ids[]` but is org-only, and most providers have
 * no equivalent at all. Where it is unavailable the key still shows, with spend
 * marked unknown rather than silently zero: a blank is honest, a zero is a lie.
 */
export function withSpend(keys, spendByProvider = {}) {
  return keys.map((k) => {
    const spent = spendByProvider[k.provider.toLowerCase()] ?? null;
    const pct =
      spent != null && k.freeLimitCents ? Math.min(100, (spent / k.freeLimitCents) * 100) : null;
    return { ...k, spentCents: spent, freeUsedPct: pct };
  });
}
