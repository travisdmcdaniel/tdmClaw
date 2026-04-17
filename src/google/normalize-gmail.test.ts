import { describe, expect, it } from "vitest";
import {
  normalizeGmailMessage,
  normalizeGmailMessageDetail,
} from "./normalize-gmail";

function makeRaw(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "msg-1",
    threadId: "thread-1",
    snippet: "Hello from the test",
    internalDate: "1700000000000",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "Subject", value: "Test subject" },
      ],
    },
    ...overrides,
  };
}

describe("normalizeGmailMessage", () => {
  it("returns a compact email with correct fields", () => {
    const result = normalizeGmailMessage(makeRaw());
    expect(result).not.toBeNull();
    expect(result?.id).toBe("msg-1");
    expect(result?.threadId).toBe("thread-1");
    expect(result?.from).toBe("Alice <alice@example.com>");
    expect(result?.subject).toBe("Test subject");
    expect(result?.snippet).toBe("Hello from the test");
    expect(result?.labels).toContain("INBOX");
  });

  it("converts internalDate to ISO string", () => {
    const result = normalizeGmailMessage(makeRaw());
    expect(result?.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("caps snippet at 300 characters", () => {
    const longSnippet = "x".repeat(500);
    const result = normalizeGmailMessage(makeRaw({ snippet: longSnippet }));
    expect(result?.snippet?.length).toBeLessThanOrEqual(300);
  });

  it("returns null for completely malformed input", () => {
    expect(normalizeGmailMessage(null)).toBeNull();
  });

  it("handles missing headers gracefully", () => {
    const raw = makeRaw({ payload: { headers: [] } });
    const result = normalizeGmailMessage(raw);
    expect(result?.from).toBe("");
    expect(result?.subject).toBe("");
  });
});

describe("normalizeGmailMessageDetail", () => {
  it("includes an excerpt field", () => {
    const raw = {
      ...makeRaw() as Record<string, unknown>,
      payload: {
        headers: [
          { name: "From", value: "Bob <bob@example.com>" },
          { name: "Subject", value: "Detail test" },
        ],
        mimeType: "text/plain",
        body: {
          data: Buffer.from("Plain text body content").toString("base64url"),
        },
      },
    };
    const result = normalizeGmailMessageDetail(raw);
    expect(result?.excerpt).toContain("Plain text body content");
  });

  it("caps excerpt at 2000 characters", () => {
    const longBody = "y".repeat(3000);
    const raw = {
      ...makeRaw() as Record<string, unknown>,
      payload: {
        headers: [],
        mimeType: "text/plain",
        body: { data: Buffer.from(longBody).toString("base64url") },
      },
    };
    const result = normalizeGmailMessageDetail(raw);
    expect(result?.excerpt?.length).toBeLessThanOrEqual(2000);
  });

  it("returns null for null input", () => {
    expect(normalizeGmailMessageDetail(null)).toBeNull();
  });
});
