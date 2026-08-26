/**
 * Google Identity Services (GIS) token model — client-side only.
 *
 * Issues a short-lived (~1h) access token directly to the browser with NO
 * backend and NO refresh token. There is intentionally nothing to persist:
 * when the token expires the user re-connects. This is what keeps us local-first.
 */
import { GMAIL_SCOPE, GOOGLE_CLIENT_ID } from "./config";

const GSI_SRC = "https://accounts.google.com/gsi/client";

let gsiPromise: Promise<void> | null = null;

/** Inject the GIS client script once. */
function loadGsi(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google auth is only available in the browser"));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiPromise) return gsiPromise;

  gsiPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

export interface AccessToken {
  token: string;
  /** Epoch ms when the token stops working. */
  expiresAt: number;
}

/**
 * Request a Gmail read-only access token.
 * @param silent when true, attempt a no-UI refresh (works only while the Google
 *   session is alive and consent was already granted); otherwise show the picker.
 */
export async function connectGoogle(opts?: { silent?: boolean }): Promise<AccessToken> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID. See SETUP.md to create an OAuth client.",
    );
  }
  await loadGsi();
  const google = window.google!;

  return new Promise<AccessToken>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GMAIL_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Authorization failed"));
          return;
        }
        resolve({
          token: resp.access_token,
          expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
        });
      },
      error_callback: (err) =>
        reject(new Error(err.message || "Authorization was cancelled")),
    });
    client.requestAccessToken(opts?.silent ? { prompt: "" } : {});
  });
}

/** Revoke a token (best-effort) when the user disconnects. */
export function revokeGoogle(token: string): void {
  if (typeof window !== "undefined" && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token);
  }
}
