import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { resolveEnvRef } from "./env";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ExecToolSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutSeconds: z.number().int().positive().default(30),
  maxOutputChars: z.number().int().positive().default(4096),
  approvalMode: z.enum(["off", "owner-only"]).default("owner-only"),
  // Denylist (default): block matched commands; all others are permitted.
  blockedCommands: z.array(z.string()).default([]),
  blockedPatterns: z.array(z.string()).default([]),
  // Allowlist mode: when enabled, ONLY commands matching an entry are permitted.
  // blockedCommands / blockedPatterns are ignored when this is active.
  allowlistMode: z.boolean().default(false),
  allowedCommands: z.array(z.string()).default([]),
  allowedPatterns: z.array(z.string()).default([]),
});

const AppConfigSchema = z.object({
  app: z.object({
    dataDir: z.string().default("./data"),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    timezone: z.string().default("UTC"),
  }),
  telegram: z.object({
    botToken: z.string().min(1),
    allowedUserIds: z.array(z.string()).min(1),
    allowedChatIds: z.array(z.string()).optional(),
    polling: z.object({
      enabled: z.boolean().default(true),
      timeoutSeconds: z.number().int().positive().default(30),
    }),
    uploads: z.object({
      retention: z.object({
        enabled: z.boolean().default(true),
      }).default({}),
    }).default({}),
  }),
  workspace: z.object({
    root: z.string().min(1),
    writableRoots: z.array(z.string()).optional(),
  }),
  models: z.object({
    provider: z.literal("openai-compatible"),
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    fallbackModels: z.array(z.string()).default([]),
    maxToolIterations: z.number().int().positive().default(4),
    maxHistoryTurns: z.number().int().positive().default(6),
    maxPromptTokensHint: z.number().int().positive().optional(),
    requestTimeoutSeconds: z.number().int().positive().default(300),
    stream: z.boolean().default(false),
    discovery: z.object({
      enabled: z.boolean().default(true),
      pollIntervalSeconds: z.number().int().positive().default(60),
    }),
  }),
  tools: z.object({
    exec: ExecToolSchema,
    applyPatch: z.object({
      enabled: z.boolean().default(true),
    }),
    gmail: z.object({
      maxResults: z.number().int().min(1).max(50).default(10),
    }).default({}),
  }),
  google: z.object({
    enabled: z.boolean().default(false),
    scopes: z.object({
      gmailRead: z.boolean().default(true),
      calendarRead: z.boolean().default(true),
      calendarWrite: z.boolean().default(false),
    }),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    pollIntervalSeconds: z.number().int().positive().default(20),
    catchUpWindowMinutes: z.number().int().nonnegative().default(10),
    jobsFile: z.string().default("jobs/jobs.json"),
    // Send an escalated Telegram alert when a job fails this many consecutive times.
    consecutiveFailureAlertThreshold: z.number().int().min(1).default(3),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const CONFIG_PATH_ENV = "TDMCLAW_CONFIG_PATH";
const DEFAULT_CONFIG_PATH = "config/config.yaml";

/**
 * Loads and validates application config.
 * Searches for the config file at TDMCLAW_CONFIG_PATH or the default path.
 * Resolves "env:VAR_NAME" references in string values.
 */
export function loadConfig(): AppConfig {
  const configPath = resolve(
    process.env[CONFIG_PATH_ENV] ?? DEFAULT_CONFIG_PATH
  );

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found at "${configPath}". ` +
        `Copy config/config.example.yaml to ${configPath} and fill in your values.`
    );
  }

  const raw = parseYaml(readFileSync(configPath, "utf-8")) as unknown;
  const resolved = resolveEnvRefs(raw as Record<string, unknown>);
  const result = AppConfigSchema.safeParse(resolved);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expands a leading ~ to the user's home directory.
 */
function expandTilde(val: string): string {
  if (val === "~") return homedir();
  if (val.startsWith("~/")) return homedir() + val.slice(1);
  return val;
}

/**
 * Recursively walks a plain object tree and resolves "env:VAR" string values.
 */
function resolveEnvRefs(
  obj: Record<string, unknown>,
  path = ""
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (typeof val === "string") {
      out[key] = expandTilde(resolveEnvRef(val, fieldPath));
    } else if (Array.isArray(val)) {
      out[key] = val.map((item, i) =>
        typeof item === "string"
          ? resolveEnvRef(item, `${fieldPath}[${i}]`)
          : item
      );
    } else if (val !== null && typeof val === "object") {
      out[key] = resolveEnvRefs(
        val as Record<string, unknown>,
        fieldPath
      );
    } else {
      out[key] = val;
    }
  }
  return out;
}
