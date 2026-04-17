import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import type { AppConfig } from "../app/config";
import type { ToolDefinition } from "./types";

function makeConfig(overrides?: Partial<AppConfig["app"]>): AppConfig {
  return {
    app: { dataDir: "./data", logLevel: "info", timezone: "UTC", ...overrides },
    telegram: {
      botToken: "tok",
      allowedUserIds: ["1"],
      polling: { enabled: true, timeoutSeconds: 30 },
      uploads: { retention: { enabled: false } },
    },
    workspace: { root: "/workspace" },
    models: {
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434",
      fallbackModels: [],
      maxToolIterations: 4,
      maxHistoryTurns: 6,
      requestTimeoutSeconds: 300,
      discovery: { enabled: false, pollIntervalSeconds: 60 },
    },
    tools: {
      exec: {
        enabled: true,
        timeoutSeconds: 30,
        maxOutputChars: 4096,
        approvalMode: "owner-only",
        blockedCommands: [],
        blockedPatterns: [],
        allowlistMode: false,
        allowedCommands: [],
        allowedPatterns: [],
      },
      applyPatch: { enabled: true },
      gmail: { maxResults: 10 },
    },
    google: {
      enabled: false,
      scopes: { gmailRead: true, calendarRead: true, calendarWrite: false },
    },
    scheduler: {
      enabled: false,
      pollIntervalSeconds: 20,
      catchUpWindowMinutes: 10,
      jobsFile: "jobs/jobs.json",
      consecutiveFailureAlertThreshold: 3,
    },
  } as AppConfig;
}

const sender = { chatId: "100", telegramUserId: "42" };

describe("buildSystemPrompt", () => {
  it("includes workspace root", () => {
    const prompt = buildSystemPrompt(makeConfig(), [], sender);
    expect(prompt).toContain("/workspace");
  });

  it("includes sender chat and user IDs", () => {
    const prompt = buildSystemPrompt(makeConfig(), [], sender);
    expect(prompt).toContain("100");
    expect(prompt).toContain("42");
  });

  it("lists tool names when tools are provided", () => {
    const tools: ToolDefinition[] = [
      { name: "list_files", description: "List files", parameters: {} },
      { name: "read_file", description: "Read a file", parameters: {} },
    ];
    const prompt = buildSystemPrompt(makeConfig(), tools, sender);
    expect(prompt).toContain("list_files");
    expect(prompt).toContain("read_file");
  });

  it("shows 'No tools available' when the tool list is empty", () => {
    const prompt = buildSystemPrompt(makeConfig(), [], sender);
    expect(prompt).toContain("No tools available");
  });

  it("includes the configured timezone", () => {
    const prompt = buildSystemPrompt(
      makeConfig({ timezone: "America/New_York" }),
      [],
      sender
    );
    expect(prompt).toContain("America/New_York");
  });
});
