import { google } from "googleapis";
import type { OAuthManager } from "./oauth";
import type { CompactEmail, CompactEmailDetail } from "./types";
import { normalizeGmailMessage, normalizeGmailMessageDetail } from "./normalize-gmail";
import { childLogger } from "../app/logger";

const log = childLogger("google");

export type GmailClient = {
  listRecent(params: {
    newerThanHours: number;
    maxResults: number;
    labelIds?: string[];
    query?: string;
  }): Promise<CompactEmail[]>;
  getMessage(params: { id: string }): Promise<CompactEmailDetail>;
};

/**
 * Creates a Gmail client backed by an authenticated OAuth client.
 */
export function createGmailClient(oauthManager: OAuthManager): GmailClient {
  function getGmailApi() {
    const auth = oauthManager.getAuthenticatedClient();
    if (!auth) throw new Error("Google account not authorized. Use /google-connect.");
    return google.gmail({ version: "v1", auth });
  }

  return {
    async listRecent({ newerThanHours, maxResults, labelIds, query }): Promise<CompactEmail[]> {
      await oauthManager.refreshIfNeeded();
      const gmail = getGmailApi();

      const q = buildQuery(newerThanHours, query);
      log.debug({ q, maxResults }, "Gmail listRecent");

      const listRes = await gmail.users.messages.list({
        userId: "me",
        q,
        labelIds,
        maxResults,
      });

      const messageIds = listRes.data.messages ?? [];
      if (messageIds.length === 0) return [];

      const messages = await Promise.all(
        messageIds.map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          return normalizeGmailMessage(msg.data);
        })
      );

      return messages;
    },

    async getMessage({ id }): Promise<CompactEmailDetail> {
      await oauthManager.refreshIfNeeded();
      const gmail = getGmailApi();

      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });

      return normalizeGmailMessageDetail(msg.data);
    },
  };
}

function buildQuery(newerThanHours: number, extraQuery?: string): string {
  const parts = [`newer_than:${newerThanHours}h`];
  if (extraQuery) parts.push(extraQuery);
  return parts.join(" ");
}
