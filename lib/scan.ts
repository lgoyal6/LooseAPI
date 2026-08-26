/**
 * Scan orchestrator: connect -> list -> fetch metadata -> parse -> persist.
 * Everything here runs in the browser. Emits progress so the UI can narrate.
 */
import { SCAN_CAP, SCAN_QUERY } from "./config";
import { connectGoogle } from "./google-auth";
import { getMessagesMeta, getProfileEmail, listMessageIds } from "./gmail";
import { parseMessages } from "./parser";
import { saveScan } from "./db";
import type { ScanResult } from "./types";

export type ScanPhase = "connecting" | "listing" | "fetching" | "parsing" | "saving";

export interface ScanProgress {
  phase: ScanPhase;
  done?: number;
  total?: number;
}

/** Run a full scan of the connected inbox. */
export async function runScan(
  onProgress: (p: ScanProgress) => void,
): Promise<ScanResult> {
  onProgress({ phase: "connecting" });
  const { token } = await connectGoogle();

  const emailAddress = await getProfileEmail(token);

  onProgress({ phase: "listing" });
  const ids = await listMessageIds(token, SCAN_QUERY, SCAN_CAP, (found) =>
    onProgress({ phase: "listing", done: found, total: SCAN_CAP }),
  );

  onProgress({ phase: "fetching", done: 0, total: ids.length });
  const messages = await getMessagesMeta(token, ids, (done, total) =>
    onProgress({ phase: "fetching", done, total }),
  );

  onProgress({ phase: "parsing" });
  const scannedAt = Date.now();
  const services = parseMessages(messages, emailAddress, scannedAt);

  onProgress({ phase: "saving" });
  await saveScan(emailAddress, services, messages.length, scannedAt);

  return { services, scanned: messages.length, emailAddress, scannedAt };
}
