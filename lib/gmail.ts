/**
 * Gmail REST calls, made DIRECTLY from the browser over CORS with the GIS
 * access token. No Gmail data ever touches our servers.
 */
const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A single message reduced to the fields we classify on. */
export interface RawMessage {
  id: string;
  from: string;
  subject: string;
  /** Epoch ms. */
  date: number;
  snippet: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** The connected account's email address (used to key the local footprint). */
export async function getProfileEmail(token: string): Promise<string> {
  const data = await apiGet<{ emailAddress: string }>("/profile", token);
  return data.emailAddress;
}

/** Page through messages.list, collecting up to `cap` message ids. */
export async function listMessageIds(
  token: string,
  query: string,
  cap: number,
  onProgress?: (found: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(500, cap - ids.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await apiGet<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(`/messages?${params.toString()}`, token);

    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken;
    onProgress?.(ids.length);
  } while (pageToken && ids.length < cap);

  return ids.slice(0, cap);
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Fetch one message in metadata format (headers + snippet, no body). */
async function getMessageMeta(token: string, id: string): Promise<RawMessage> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "Subject", "Date"]) params.append("metadataHeaders", h);

  const m = await apiGet<{
    payload?: { headers?: GmailHeader[] };
    internalDate?: string;
    snippet?: string;
  }>(`/messages/${id}?${params.toString()}`, token);

  const headers = m.payload?.headers ?? [];
  const internal = Number(m.internalDate);
  const date = Number.isFinite(internal) && internal > 0
    ? internal
    : Date.parse(header(headers, "Date")) || 0;

  return {
    id,
    from: header(headers, "From"),
    subject: header(headers, "Subject"),
    date,
    snippet: m.snippet ?? "",
  };
}

/**
 * Fetch metadata for many message ids with bounded concurrency. Individual
 * failures are skipped rather than aborting the whole scan.
 */
export async function getMessagesMeta(
  token: string,
  ids: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 12,
): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        out.push(await getMessageMeta(token, id));
      } catch {
        // skip a single bad message
      }
      onProgress?.(++done, ids.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, worker),
  );
  return out;
}
