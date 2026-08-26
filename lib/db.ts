/**
 * Local persistence via IndexedDB (Dexie). This is the ONLY place scan results
 * are stored, and it lives entirely in the user's browser.
 */
import Dexie, { type Table } from "dexie";
import type { DetectedService } from "./types";

export interface ScanMeta {
  emailAddress: string;
  scannedAt: number;
  messageCount: number;
  serviceCount: number;
}

class LooseDb extends Dexie {
  services!: Table<DetectedService, string>;
  scans!: Table<ScanMeta, string>;

  constructor() {
    super("looseapi");
    this.version(1).stores({
      // `id` is `${emailAddress}:${key}`; secondary indexes for filtering.
      services: "id, emailAddress, category, tier, lastSeen",
      scans: "emailAddress, scannedAt",
    });
  }
}

/** Guard against constructing IndexedDB during SSR. */
export const db = typeof window !== "undefined" ? new LooseDb() : (undefined as unknown as LooseDb);

/** Replace all stored services for an inbox with a fresh scan. */
export async function saveScan(
  emailAddress: string,
  services: DetectedService[],
  messageCount: number,
  scannedAt: number,
): Promise<void> {
  await db.transaction("rw", db.services, db.scans, async () => {
    await db.services.where("emailAddress").equals(emailAddress).delete();
    await db.services.bulkPut(services);
    await db.scans.put({
      emailAddress,
      scannedAt,
      messageCount,
      serviceCount: services.length,
    });
  });
}

export async function loadServices(emailAddress: string): Promise<DetectedService[]> {
  return db.services.where("emailAddress").equals(emailAddress).toArray();
}

export async function lastScan(emailAddress: string): Promise<ScanMeta | undefined> {
  return db.scans.get(emailAddress);
}

/** Most recently scanned inbox, if any (to auto-restore on load). */
export async function mostRecentScan(): Promise<ScanMeta | undefined> {
  const all = await db.scans.toArray();
  return all.sort((a, b) => b.scannedAt - a.scannedAt)[0];
}

/** Nuke everything — backs the "wipe local data" button. */
export async function wipeAll(): Promise<void> {
  await db.transaction("rw", db.services, db.scans, async () => {
    await db.services.clear();
    await db.scans.clear();
  });
}
