import type { Context } from "grammy";
import type { AppConfig } from "../app/config";
import type { AgentRuntime } from "../agent/runtime";
import type { ModelDiscovery } from "../agent/providers/discovery";
import type { Database } from "better-sqlite3";
import { childLogger } from "../app/logger";
import { isSenderAllowed } from "./guards";
import { parseCommand } from "./routing";
import { formatError, toMarkdownV2 } from "./format";
import { createNewSession } from "../agent/session";
import { deleteMessagesOlderThan } from "../storage/messages";
import { prepareInboundMessage } from "./inbound";
import type { GoogleCommandDeps } from "./commands/google";
import { routeGoogleCommand } from "./commands/google";

const log = childLogger("telegram");

type MessageHandler = (ctx: Context) => Promise<void>;

/**
 * Builds the unified message handler that routes commands and plain messages.
 */
export function buildMessageHandler(
  config: AppConfig["telegram"],
  workspaceRoot: string,
  agentRuntime: AgentRuntime,
  discovery: ModelDiscovery,
  db: Database,
  googleDeps?: GoogleCommandDeps
): MessageHandler {
  return async (ctx: Context): Promise<void> => {
    const userId = String(ctx.from?.id ?? "");
    const chatId = String(ctx.chat?.id ?? "");

    if (!isSenderAllowed(config, userId, chatId)) {
      log.warn({ userId, chatId }, "Rejected message from unauthorized sender");
      return;
    }

    let inbound;
    try {
      inbound = await prepareInboundMessage(ctx, config.botToken, workspaceRoot, config.uploads);
    } catch (err) {
      log.error({ err, userId, chatId }, "Failed to prepare inbound Telegram message");
      await ctx.reply(formatError(err));
      return;
    }

    if (inbound.kind === "command") {
      await handleCommand(ctx, inbound.text, discovery, db, googleDeps);
      return;
    }

    if (inbound.kind === "unsupported-document") {
      await ctx.reply(
        "I can read attached .txt, .md, and .json files. " +
          "Send one of those with an optional message."
      );
      return;
    }

    if (inbound.kind === "empty") {
      await ctx.reply(
        "Send a text message, or attach a .txt, .md, or .json file with an optional caption."
      );
      return;
    }

    // Plain conversational message — run the agent loop
    // Send "typing" every 4s for the duration of the LLM call (indicator expires after 5s).
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => undefined);
    }, 4000);
    void ctx.replyWithChatAction("typing");

    try {
      const response = await agentRuntime.runTurn({
        userMessage: inbound.text,
        sender: { telegramUserId: userId, chatId, username: ctx.from?.username },
      });
      const outText = toMarkdownV2(response.text).trim();
      if (outText) {
        await ctx.reply(outText, { parse_mode: "MarkdownV2" });
      } else {
        log.warn({ userId, chatId }, "Agent returned empty response, skipping send");
      }
    } catch (err) {
      log.error({ err, userId, chatId }, "Agent turn failed");
      await ctx.reply(formatError(err));
    } finally {
      clearInterval(typingInterval);
    }
  };
}

// ---------------------------------------------------------------------------
// Command router
// ---------------------------------------------------------------------------

const GOOGLE_COMMANDS = new Set([
  "google-setup",
  "google-connect",
  "google-complete",
  "google-status",
  "google-disconnect",
]);

async function handleCommand(
  ctx: Context,
  text: string,
  discovery: ModelDiscovery,
  db: Database,
  googleDeps?: GoogleCommandDeps
): Promise<void> {
  const { command, args } = parseCommand(text);

  // Route Google commands
  if (GOOGLE_COMMANDS.has(command)) {
    if (!googleDeps) {
      await ctx.reply("Google integration is not configured.");
      return;
    }
    await routeGoogleCommand(ctx, command, args.join(" "), googleDeps);
    return;
  }

  switch (command) {
    case "new":
      await handleNew(ctx, db);
      break;
    case "models":
      await handleModels(ctx, discovery);
      break;
    case "model":
      await handleModel(ctx, discovery);
      break;
    case "setmodel":
      await handleSetModel(ctx, discovery, args);
      break;
    case "setfallback":
      await handleSetFallback(ctx, discovery, args);
      break;
    case "jobs":
      // TODO: implement in Phase 4 (Scheduler)
      await ctx.reply("Scheduler management is not yet implemented.");
      break;
    case "briefing":
      // TODO: implement in Phase 4 (Scheduler)
      await ctx.reply("Daily briefing is not yet implemented.");
      break;
    case "start":
    case "help":
      await ctx.reply(
        "Available commands:\n" +
          "/new — start a fresh session (clears context)\n" +
          "/models — list available models\n" +
          "/model — show active model\n" +
          "/setmodel <name> — switch model\n" +
          "/setfallback <name...> — set fallback chain\n" +
          "/google-setup — upload Google OAuth client credentials\n" +
          "/google-connect <email> — connect Google account\n" +
          "/google-complete <url> — finish Google authorization\n" +
          "/google-status — show Google connection status\n" +
          "/google-disconnect — disconnect Google account\n" +
          "/jobs — manage scheduled jobs\n" +
          "/briefing — run daily briefing now"
      );
      break;
    default:
      await ctx.reply(`Unknown command: /${command}`);
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

async function handleNew(ctx: Context, db: Database): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const userId = String(ctx.from?.id ?? "");

  createNewSession(db, chatId, userId);

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const deleted = deleteMessagesOlderThan(db, cutoff);

  const cleanupNote =
    deleted > 0
      ? ` Removed ${deleted} message${deleted !== 1 ? "s" : ""} older than 1 week.`
      : "";

  await ctx.reply(`New session started.${cleanupNote}`);
}

// ---------------------------------------------------------------------------
// Model management handlers
// ---------------------------------------------------------------------------

async function handleModels(ctx: Context, discovery: ModelDiscovery): Promise<void> {
  const models = await discovery.listAvailable();
  if (models.length === 0) {
    await ctx.reply("No models found on the Ollama endpoint.");
    return;
  }
  const active = discovery.getActive();
  const lines = models.map((m) => {
    const marker = m.name === active?.name ? "* " : "  ";
    const size = m.size ? ` (${(m.size / 1e9).toFixed(1)}GB)` : "";
    return `${marker}${m.name}${size}`;
  });
  await ctx.reply(`Available models (* = active):\n${lines.join("\n")}`);
}

async function handleModel(ctx: Context, discovery: ModelDiscovery): Promise<void> {
  const active = discovery.getActive();
  const fallbacks = discovery.getFallbackChain();
  if (!active) {
    await ctx.reply("No active model. Use /setmodel <name> to select one.");
    return;
  }
  const fallbackLine =
    fallbacks.length > 0
      ? `\nFallbacks: ${fallbacks.map((m) => m.name).join(", ")}`
      : "";
  await ctx.reply(`Active model: ${active.name}${fallbackLine}`);
}

async function handleSetModel(
  ctx: Context,
  discovery: ModelDiscovery,
  args: string[]
): Promise<void> {
  const name = args[0];
  if (!name) {
    await ctx.reply("Usage: /setmodel <model-name>");
    return;
  }
  const available = await discovery.listAvailable();
  if (!available.some((m) => m.name === name)) {
    await ctx.reply(
      `Model "${name}" is not available. Use /models to see available models.`
    );
    return;
  }
  await discovery.setActive(name);
  await ctx.reply(`Active model set to: ${name}`);
}

async function handleSetFallback(
  ctx: Context,
  discovery: ModelDiscovery,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    await ctx.reply("Usage: /setfallback <name> [name...]");
    return;
  }
  await discovery.setFallbackChain(args);
  await ctx.reply(`Fallback chain set: ${args.join(" → ")}`);
}
