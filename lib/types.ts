/** Shared domain types for the footprint scanner. */

export type ServiceCategory =
  | "dev-tool"
  | "cloud"
  | "ai"
  | "database"
  | "auth"
  | "payments"
  | "email"
  | "observability"
  | "saas"
  | "media"
  | "social"
  | "other";

/** Best-guess billing relationship with a service. */
export type Tier = "free" | "trial" | "paid" | "unknown";

/** The kind of email that tied this address to a service. */
export type EventKind =
  | "signup"
  | "receipt"
  | "trial"
  | "renewal"
  | "security"
  | "marketing"
  | "other";

/** A service detected in the user's inbox, deduped across many messages. */
export interface DetectedService {
  /** Stable dedup key: a known service id, else the sender domain. */
  key: string;
  /** Composite primary key for IndexedDB: `${emailAddress}:${key}`. */
  id: string;
  /** Display name. */
  name: string;
  /** Representative sender domain. */
  domain: string;
  category: ServiceCategory;
  tier: Tier;
  isTrial: boolean;
  /** No activity within DORMANT_DAYS. */
  isDormant: boolean;
  /** Epoch ms of earliest / latest message from this service. */
  firstSeen: number;
  lastSeen: number;
  /** How many messages contributed to this detection. */
  messageCount: number;
  /** Distinct event kinds observed. */
  events: EventKind[];
  /** Which connected inbox this footprint belongs to. */
  emailAddress: string;
}

export interface ScanResult {
  services: DetectedService[];
  scanned: number;
  emailAddress: string;
  scannedAt: number;
}
