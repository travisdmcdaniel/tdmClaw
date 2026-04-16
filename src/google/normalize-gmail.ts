import type { CompactEmail, CompactEmailDetail } from "./types";

const SNIPPET_MAX = 300;
const EXCERPT_MAX = 2000;

/**
 * Normalizes a raw Gmail API message resource (metadata format) into a
 * compact representation safe for LLM consumption.
 */
export function normalizeGmailMessage(raw: unknown): CompactEmail | null {
  try {
    const msg = raw as Record<string, unknown>;
    const headers = (
      (msg.payload as Record<string, unknown>)?.headers as Array<{
        name?: string;
        value?: string;
      }>
    ) ?? [];

    const get = (name: string): string =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

    return {
      id: String(msg.id ?? ""),
      threadId: String(msg.threadId ?? ""),
      from: get("From"),
      subject: get("Subject"),
      receivedAt: internalDateToIso(msg.internalDate) || get("Date"),
      snippet: String(msg.snippet ?? "").slice(0, SNIPPET_MAX),
      labels: Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Normalizes a raw Gmail API message resource (full format) into a compact
 * detail object that includes a body excerpt.
 */
export function normalizeGmailMessageDetail(raw: unknown): CompactEmailDetail | null {
  const base = normalizeGmailMessage(raw);
  if (!base) return null;

  const msg = raw as Record<string, unknown>;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const text = extractText(payload) ?? "";

  return { ...base, excerpt: text.slice(0, EXCERPT_MAX) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function internalDateToIso(internalDate: unknown): string {
  if (typeof internalDate !== "string" && typeof internalDate !== "number") return "";
  const ms = parseInt(String(internalDate), 10);
  if (isNaN(ms)) return "";
  return new Date(ms).toISOString();
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const p = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };

  const mt = p.mimeType ?? "";

  if (mt === "text/plain" && p.body?.data) {
    return decodeBase64url(p.body.data);
  }

  if (p.parts) {
    // First pass: prefer explicit text/plain parts
    for (const part of p.parts) {
      const child = part as { mimeType?: string };
      if (child.mimeType === "text/plain") {
        const t = extractText(part);
        if (t) return t;
      }
    }
    // Second pass: recurse into any part (handles multipart/alternative etc.)
    for (const part of p.parts) {
      const t = extractText(part);
      if (t) return t;
    }
  }

  if (mt === "text/html" && p.body?.data) {
    return stripHtml(decodeBase64url(p.body.data));
  }

  return null;
}

function decodeBase64url(b64url: string): string {
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
