#!/usr/bin/env node
/**
 * spend-keys — manage API keys held in the macOS Keychain.
 *
 *   spend-keys list
 *   spend-keys add <id> <provider> [--free-limit <dollars>] [--note "..."]
 *   spend-keys reveal <id>
 *   spend-keys rm <id>
 *
 * `add` reads the secret from stdin, never from argv, so it never lands in
 * shell history or in another process's view of `ps`.
 */
import { addKey, listKeys, revealKey, removeKey } from "../lib/spend/keys.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = undefined) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : d;
};
const pos = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));

async function readStdin() {
  if (process.stdin.isTTY) {
    process.stderr.write("paste the key, then press Ctrl-D: ");
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString().trim();
}

const fmt = (c) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

switch (cmd) {
  case "add": {
    const [id, provider] = pos;
    if (!id || !provider) throw new Error("usage: spend-keys add <id> <provider>");
    const secret = await readStdin();
    const limit = flag("free-limit");
    const e = await addKey({
      id,
      provider,
      secret,
      freeLimit: limit ? Math.round(parseFloat(limit) * 100) : null,
      note: flag("note", ""),
    });
    console.log(`stored ${e.provider} (…${e.last4}) in the Keychain as ${id}`);
    break;
  }
  case "reveal": {
    if (!pos[0]) throw new Error("usage: spend-keys reveal <id>");
    process.stdout.write((await revealKey(pos[0])) + "\n");
    break;
  }
  case "rm": {
    await removeKey(pos[0]);
    console.log(`removed ${pos[0]}`);
    break;
  }
  case "list":
  case undefined: {
    const keys = await listKeys();
    if (!keys.length) {
      console.log("no keys registered — spend-keys add <id> <provider>");
      break;
    }
    const w = (s, n) => String(s).padEnd(n);
    console.log(`\n  ${w("ID", 22)}${w("PROVIDER", 16)}${w("KEY", 10)}${w("FREE LIMIT", 12)}KEYCHAIN`);
    for (const k of keys) {
      console.log(
        `  ${w(k.id, 22)}${w(k.provider, 16)}${w("…" + k.last4, 10)}${w(fmt(k.freeLimitCents), 12)}${k.inKeychain ? "ok" : "MISSING"}`,
      );
    }
    console.log(`\n  secrets are in the Keychain; this file holds only metadata\n`);
    break;
  }
  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
