import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isSupportedTextDocument, prepareInboundMessage } from "./inbound";

describe("isSupportedTextDocument", () => {
  it("accepts supported extensions case-insensitively", () => {
    expect(isSupportedTextDocument("notes.txt")).toBe(true);
    expect(isSupportedTextDocument("README.MD")).toBe(true);
    expect(isSupportedTextDocument("client.JSON")).toBe(true);
  });

  it("rejects unsupported or missing filenames", () => {
    expect(isSupportedTextDocument("image.png")).toBe(false);
    expect(isSupportedTextDocument(undefined)).toBe(false);
  });
});

describe("prepareInboundMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats document captions as command text", async () => {
    const result = await prepareInboundMessage(
      {
        message: {
          caption: "/google_setup",
          document: { file_id: "doc-1", file_name: "client_secret.json" },
        },
      } as any,
      "token",
      "/workspace",
      { retention: { enabled: true } }
    );

    expect(result).toEqual({ kind: "command", text: "/google_setup" });
  });

  it("saves supported text documents to the workspace and references the path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "tdmclaw-inbound-"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "{\"hello\":\"world\"}",
      })
    );

    const result = await prepareInboundMessage(
      {
        message: {
          caption: "Please summarize this.",
          document: { file_id: "doc-2", file_name: "payload.json" },
        },
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "documents/payload.json" }),
        },
      } as any,
      "telegram-token",
      workspaceRoot,
      { retention: { enabled: true } }
    );

    expect(result.kind).toBe("agent");
    if (result.kind !== "agent") {
      throw new Error("Expected agent payload");
    }
    expect(result.text).toContain("Please summarize this.");
    expect(result.text).toContain('An attachment was saved to workspace path "/telegram_uploads/');
    expect(result.text).toContain("Original filename: payload.json");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bottelegram-token/documents/payload.json"
    );
    const savedPath = result.text.match(/workspace path "([^"]+)"/)?.[1];
    expect(savedPath).toBeTruthy();
    const savedFile = readFileSync(join(workspaceRoot, savedPath ?? ""), "utf-8");
    expect(savedFile).toBe("{\"hello\":\"world\"}");
  });

  it("flags unsupported documents without text", async () => {
    const result = await prepareInboundMessage(
      {
        message: {
          document: { file_id: "doc-3", file_name: "photo.png" },
        },
      } as any,
      "token",
      "/workspace",
      { retention: { enabled: true } }
    );

    expect(result).toEqual({ kind: "unsupported-document", filename: "photo.png" });
  });

  it("prunes old uploads when retention is enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "tdmclaw-inbound-"));
    const uploadDir = join(workspaceRoot, "telegram_uploads");
    const oldFile = join(uploadDir, "old.txt");
    const freshFile = join(uploadDir, "fresh.txt");
    mkdirSync(uploadDir, { recursive: true });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "new content",
      })
    );

    writeFileSync(oldFile, "old", "utf-8");
    writeFileSync(freshFile, "fresh", "utf-8");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    await prepareInboundMessage(
      {
        message: {
          caption: "check this",
          document: { file_id: "doc-4", file_name: "notes.txt" },
        },
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "documents/notes.txt" }),
        },
      } as any,
      "telegram-token",
      workspaceRoot,
      { retention: { enabled: true } }
    );

    expect(() => readFileSync(oldFile, "utf-8")).toThrow();
    expect(readFileSync(freshFile, "utf-8")).toBe("fresh");
  });

  it("does not prune old uploads when retention is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "tdmclaw-inbound-"));
    const uploadDir = join(workspaceRoot, "telegram_uploads");
    const oldFile = join(uploadDir, "old.txt");
    mkdirSync(uploadDir, { recursive: true });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "new content",
      })
    );

    writeFileSync(oldFile, "old", "utf-8");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    await prepareInboundMessage(
      {
        message: {
          caption: "check this",
          document: { file_id: "doc-5", file_name: "notes.txt" },
        },
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "documents/notes.txt" }),
        },
      } as any,
      "telegram-token",
      workspaceRoot,
      { retention: { enabled: false } }
    );

    expect(readFileSync(oldFile, "utf-8")).toBe("old");
  });
});
