/**
 * Discord delivery, reusing the bot the rest of the machine already registered
 * rather than adding a webhook. One token to rotate, one channel to mute, and
 * spend alerts land in the same DM as the automation digests.
 *
 * Token: keychain item AGENTMON_DISCORD_TOKEN. Channel: ~/.agentmon/state/.discord_dm.
 * Both are read at send time, so nothing is cached in this repo.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const API = "https://discord.com/api/v10";

async function token() {
  if (process.env.AGENTMON_DISCORD_TOKEN) return process.env.AGENTMON_DISCORD_TOKEN;
  try {
    const { stdout } = await exec("security", [
      "find-generic-password", "-w",
      "-s", "AGENTMON_DISCORD_TOKEN",
      "-a", process.env.USER ?? "",
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function channel() {
  try {
    return (await readFile(join(homedir(), ".agentmon", "state", ".discord_dm"), "utf8")).trim();
  } catch {
    return "";
  }
}

/**
 * Which alerts are worth interrupting someone for.
 *
 * The test is not severity, it is whether the alert is still actionable. A
 * charge that already happened cannot be undone by reading about it sooner, so
 * it belongs on the dashboard. A trial that converts on Friday, a balance three
 * days from zero, a failed payment — those have a window, and a late alert is a
 * useless one.
 *
 * `unread_money` is deliberately excluded: it is a backlog, not an event, and it
 * was the class that would have DM'd five lines about mail already sitting in
 * the inbox.
 */
const PUSHABLE = new Set([
  "credit_burndown",
  "trial_converting",
  "payment_failed",
  "account_closed",
  "credits_exhausted",
  "new_merchant",
]);

export function pushable(alerts, { burndownDays = 5 } = {}) {
  return alerts.filter((a) => {
    if (!PUSHABLE.has(a.kind)) return false;
    // A burndown 40 days out is a dashboard fact; one inside the window is news.
    if (a.kind === "credit_burndown") {
      const m = /~([\d.]+) days/.exec(a.message);
      return m ? parseFloat(m[1]) <= burndownDays : true;
    }
    return true;
  });
}

/** Post one message. Returns {sent, reason} rather than throwing. */
export async function send(content) {
  const [tok, ch] = await Promise.all([token(), channel()]);
  if (!tok) return { sent: false, reason: "no token (keychain AGENTMON_DISCORD_TOKEN)" };
  if (!ch) return { sent: false, reason: "no channel (~/.agentmon/state/.discord_dm)" };

  // Discord rejects the whole request past 2000 characters, so trim rather than drop.
  const body = content.length > 1990 ? content.slice(0, 1990) + "\n…" : content;
  const res = await fetch(`${API}/channels/${ch}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ content: body }),
  });
  return { sent: res.ok, reason: res.ok ? "ok" : `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` };
}
