import type { CompactEmail, CompactEmailDetail } from "./types";

const MAX_SNIPPET_LENGTH = 300;
const MAX_EXCERPT_LENGTH = 1500;

type GmailMessageResource = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
    body?: { data?: string | null } | null;
    parts?: Array<{
      mimeType?: string | null;
      body?: { data?: string | null } | null;
    }> | null;
  } | null;
};

/**
 * Normalizes a raw Gmail message resource into a compact representation.
 */
export function normalizeGmailMessage(msg: GmailMessageResource): CompactEmail {
  const headers = msg.payload?.headers ?? [];

  const getHeader = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: getHeader("From"),
    subject: getHeader("Subject"),
    receivedAt: getHeader("Date"),
    snippet: (msg.snippet ?? "").slice(0, MAX_SNIPPET_LENGTH),
    labels: msg.labelIds?.filter(Boolean) as string[] | undefined,
  };
}

/**
 * Normalizes a raw Gmail message into a compact detail object including a body excerpt.
 */
export function normalizeGmailMessageDetail(
  msg: GmailMessageResource
): CompactEmailDetail {
  const base = normalizeGmailMessage(msg);
  const excerpt = extractBodyExcerpt(msg);
  return { ...base, excerpt };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBodyExcerpt(msg: GmailMessageResource): string {
  const payload = msg.payload;
  if (!payload) return "";

  // Try plain text part first
  const plainPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  const rawData = plainPart?.body?.data ?? payload.body?.data;

  if (!rawData) return "";

  const decoded = Buffer.from(rawData, "base64url").toString("utf-8");
  const stripped = decoded.replace(/\s+/g, " ").trim();
  return stripped.slice(0, MAX_EXCERPT_LENGTH);
}
