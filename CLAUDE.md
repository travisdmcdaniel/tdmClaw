# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build

# Start built app
npm start

# Development with hot reload
npm run dev

# Run tests (watch mode)
npm test

# Run tests once (CI)
npm run test:run

# Type check only (no emit)
npm run typecheck

# Lint
npm run lint
```

To run a single test file: `npx vitest run src/path/to/file.test.ts`

## Configuration

Copy `config/config.example.yaml` to `config/config.yaml` before running. The config path can be overridden with `TDMCLAW_CONFIG_PATH`. String values support `env:VAR_NAME` syntax to pull from environment variables — validated at startup via Zod (`src/app/config.ts`). Sensitive values can also be provided via `.env` (see `.env.example`); the env override pattern is `TDMCLAW_<SECTION>_<KEY>`.

## Architecture

### Bootstrap sequence (`src/app/bootstrap.ts`)

Subsystems are initialized in strict dependency order: env/config → logger → SQLite DB + migrations → model provider + discovery → tool registry → agent runtime → Telegram bot → HTTP server → scheduler → Telegram polling. Shutdown handlers are registered via `onShutdown()` and triggered on SIGTERM/SIGINT.

### Agent loop (`src/agent/loop.ts`)

`runAgentLoop` is the core: build a message array from history + current user message, call the model, if the output is a tool call execute it and append the result, repeat until a plain message is returned or `maxToolIterations` is hit. The loop is stateless — session history is loaded before the call and persisted after by the runtime (`src/agent/runtime.ts`).

### Tool registry (`src/agent/tool-registry.ts`)

Tools are registered conditionally based on config flags (workspace, exec, applyPatch, Google). Each tool implements `ToolHandler` with a `definition` (name, description, JSON schema for args) and an `execute(args, ctx)` method. `ToolContext` carries `sessionId`, `workspaceRoot`, `senderTelegramUserId`, `logger`, and `db`. The registry exposes `getDefinitions()` (passed to the model) and `execute()` (called by the loop).

### Model provider (`src/agent/providers/`)

`openai-compatible.ts` wraps any OpenAI-compatible endpoint (default: Ollama at `http://127.0.0.1:11434`). `discovery.ts` polls `GET /api/tags` on the configured interval to keep the available model list fresh. Active model and fallback chain are persisted in the `settings` SQLite table so selections survive restarts.

### Storage (`src/storage/`)

SQLite via `better-sqlite3`, opened in WAL mode. Schema version tracked with `PRAGMA user_version`. All migrations live in `src/storage/migrations.ts` as a flat array — add new entries there. Per-table DAOs: `sessions.ts`, `messages.ts`, `jobs.ts`, `job-runs.ts`, `credentials.ts`, `settings.ts`.

### Telegram (`src/telegram/`)

Uses grammy in long-polling mode. `guards.ts` enforces the `allowedUserIds`/`allowedChatIds` allowlist before any message reaches the handler. `routing.ts` detects commands (prefix `/`). `handler.ts` dispatches commands and plain messages. `format.ts` converts agent output to Telegram-safe markdown.

### Security (`src/security/`)

- `paths.ts` — `assertWithinWorkspace()` blocks file tool access outside the configured workspace root.
- `exec-policy.ts` — `checkExecPolicy()` enforces blocked exact commands and blocked regex patterns before shell execution.
- `redact.ts` — strips OAuth tokens from log output.

### Scheduler (`src/scheduler/`)

Poll-based: wakes every `pollIntervalSeconds`, queries for due jobs. Claims are atomic via a claim token + expiry in the `scheduled_jobs` table (`locks.ts`), preventing double-execution on restart. Job handlers live in `src/scheduler/jobs/` and are registered in `service.ts`.

### Google integration (`src/google/`)

OAuth flow initiated via `/google-connect` in Telegram → HTTP server (`src/api/google-callback.ts`) receives the callback → tokens stored in the `credentials` table. `token-store.ts` handles read/write/refresh. Gmail and Calendar clients (`gmail.ts`, `calendar.ts`) normalize API responses into compact representations before passing them to tools or the briefing service.

## Implementation status

The project follows a phased plan (`tdmClaw_IP.md`). Phase 1 (foundation: config, logger, DB, bootstrap) is complete. Phases 2–5 have stub files with `// TODO (Phase N)` markers where wiring still needs to be added — notably the tool registry currently registers no tools, and several handler files are scaffolded but not fully implemented.
