import type { GoogleTokenStore } from "./token-store";
import type { CompactEmail, CompactEmailDetail } from "./types";
import { normalizeGmailMessage, normalizeGmailMessageDetail } from "./normalize-gmail";
import { childLogger } from "../app/logger";

const log = childLogger("google");
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailClient = {
  listRecent(params: {
    newerThanHours: number;
    maxResults: number;
    labelIds?: string[];
    query?: string;
  }): Promise<CompactEmail[]>;
  getMessage(params: { id: string }): Promise<CompactEmailDetail | null>;
};

/**
 * Gmail API client using plain fetch. Reads the access token from
 * GoogleTokenStore on each call (auto-refreshes if near expiry).
 */
export class GmailClientImpl implements GmailClient {
  constructor(private readonly tokens: GoogleTokenStore) {}

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokens.getAccessToken()}` };
  }

  async listRecent({
    newerThanHours,
    maxResults,
    labelIds,
    query,
  }: {
    newerThanHours: number;
    maxResults: number;
    labelIds?: string[];
    query?: string;
  }): Promise<CompactEmail[]> {
    const q = [`newer_than:${newerThanHours}h`, query].filter(Boolean).join(" ");
    const url = new URL(`${GMAIL_BASE}/messages`);
    url.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
    url.searchParams.set("q", q);
    labelIds?.forEach((l) => url.searchParams.append("labelIds", l));

    log.debug({ q, maxResults }, "Gmail listRecent");

    const r = await fetch(url, { headers: await this.authHeaders() });
    if (!r.ok) throw new Error(`Gmail list failed (${r.status}): ${await r.text()}`);

    const data = (await r.json()) as { messages?: Array<{ id: string }> };
    const ids = (data.messages ?? []).slice(0, maxResults).map((m) => m.id);

    const results = await Promise.all(ids.map((id) => this.fetchMetadata(id)));
    return results.filter((e): e is CompactEmail => e !== null);
  }

  async getMessage({ id }: { id: string }): Promise<CompactEmailDetail | null> {
    const r = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
      headers: await this.authHeaders(),
    });
    if (!r.ok) return null;
    return normalizeGmailMessageDetail(await r.json());
  }

  private async fetchMetadata(id: string): Promise<CompactEmail | null> {
    const url =
      `${GMAIL_BASE}/messages/${id}?format=metadata` +
      `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
    const r = await fetch(url, { headers: await this.authHeaders() });
    if (!r.ok) return null;
    return normalizeGmailMessage(await r.json());
  }
}

export function createGmailClient(tokens: GoogleTokenStore): GmailClient {
  return new GmailClientImpl(tokens);
}
