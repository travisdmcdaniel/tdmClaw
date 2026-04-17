# tdmClaw Implementation Plan

## Document Metadata

- Project: tdmClaw
- Document Type: Implementation Plan
- Version: 0.1
- Status: Active
- Related Documents: `tdmClaw_PRD.md`, `tdmClaw_TDD.md`

---

## Phase 1 — Foundation

**Goal:** Runnable process with config, logging, DB, and graceful shutdown. No Telegram yet.

| # | Task | Key Files |
|---|------|-----------|
| 1.1 | Initialize repo: `package.json`, `tsconfig.json`, `eslint`, `vitest` | root |
| 1.2 | Config loader: YAML file + env override + zod validation | `src/app/config.ts`, `src/app/env.ts` |
| 1.3 | Structured logger (pino) | `src/app/logger.ts` |
| 1.4 | SQLite wrapper + migration runner | `src/storage/db.ts`, `src/storage/migrations.ts` |
| 1.5 | Initial schema migrations: `sessions`, `messages`, `scheduled_jobs`, `job_runs`, `oauth_states`, `credentials`, `settings` | `src/storage/migrations.ts` |
| 1.6 | Bootstrap wiring + graceful shutdown | `src/app/bootstrap.ts`, `src/app/shutdown.ts`, `src/index.ts` |

**Exit criteria:** `node dist/index.js` starts, opens DB, logs readiness, shuts down cleanly on SIGTERM.

---

## Phase 2 — Telegram Adapter + Agent Loop

**Goal:** Receive Telegram messages, run a tool-using agent loop against a local model, reply.

| # | Task | Key Files |
|---|------|-----------|
| 2.1 | Telegram bot setup with grammy + polling | `src/telegram/bot.ts`, `src/telegram/polling.ts` |
| 2.2 | Sender allowlist guard | `src/telegram/guards.ts` |
| 2.3 | Inbound message → `TelegramInboundRequest` normalization | `src/telegram/handler.ts`, `src/telegram/types.ts` |
| 2.4 | Session store (upsert by `telegram:<chatId>`) | `src/storage/sessions.ts` |
| 2.5 | Message store (persist turns) | `src/storage/messages.ts` |
| 2.6 | History loader (bounded, last N turns) | `src/agent/history.ts` |
| 2.7 | Compact system prompt builder | `src/agent/prompt.ts` |
| 2.8 | OpenAI-compatible model provider with Ollama discovery | `src/agent/providers/openai-compatible.ts`, `src/agent/providers/discovery.ts`, `src/agent/providers/types.ts` |
| 2.9 | Model selection persistence (`settings` table) | `src/storage/settings.ts` |
| 2.10 | `/models`, `/model`, `/setmodel`, `/setfallback` Telegram commands | `src/telegram/handler.ts` |
| 2.11 | Tool registry + tool definition interface | `src/agent/tool-registry.ts`, `src/agent/types.ts` |
| 2.12 | Tool loop with max-iteration enforcement | `src/agent/loop.ts` |
| 2.13 | Agent runtime (orchestrates 2.6–2.12) | `src/agent/runtime.ts` |
| 2.14 | Workspace path guard (`assertWithinWorkspace`) | `src/security/paths.ts` |
| 2.15 | `list_files` tool | `src/tools/list-files.ts` |
| 2.16 | `read_file` tool | `src/tools/read-file.ts` |
| 2.17 | `write_file` tool | `src/tools/write-file.ts` |
| 2.18 | `apply_patch` tool | `src/tools/apply-patch.ts` |
| 2.19 | `exec` tool with policy enforcement | `src/tools/exec.ts`, `src/security/exec-policy.ts` |
| 2.20 | Wire tools into tool registry | `src/agent/tool-registry.ts` |
| 2.21 | Response formatter + Telegram reply sender | `src/telegram/format.ts`, `src/telegram/routing.ts` |

**Exit criteria:** Send a Telegram message → agent calls a file tool → reply arrives. Prompt stays under 600 tokens for a baseline turn.

---

## Phase 3 — Google OAuth + Connectors

**Goal:** Authorize a Google account entirely through Telegram (no HTTP server, no LAN hostname), then read Gmail and Calendar.

**Approach:** Loopback manual flow (same as gogcli `--manual`). The user uploads `client_secret.json` via `/google-setup`, runs `/google-connect` to get an auth URL, opens it in any browser, and pastes the failed-redirect URL back with `/google-complete`. No HTTP callback server is required.

**Config change:** Remove `google.clientId`, `google.clientSecret`, `google.redirectBaseUrl`, and `auth.callbackHost/Port` from `config.yaml`. Client credentials are stored in SQLite (uploaded by the user), not in config. The only remaining Google config fields are `google.enabled` and `google.scopes`.

| # | Task | Key Files |
|---|------|-----------|
| 3.1 | DB migration: add `google_client`, `oauth_states`, `credentials` tables | `src/storage/migrations.ts` |
| 3.2 | Scope constants and `buildScopes()` builder | `src/google/scopes.ts` |
| 3.3 | Shared types: `GoogleClientCredentials`, `TokenSet`, `ParsedRedirect`, compact email/calendar types | `src/google/types.ts` |
| 3.4 | `client_secret.json` parser — validates Desktop vs Web credential, actionable errors | `src/google/parse-client-secret.ts` |
| 3.5 | Client credentials store — upsert/read/delete for the `google_client` table | `src/google/client-store.ts` |
| 3.6 | Redirect URI generator — random loopback port in dynamic range (49152–65535), nothing listens | `src/google/redirect-uri.ts` |
| 3.7 | Redirect URL parser — extracts `code`, `state`, base `redirectUri` from pasted URL | `src/google/parse-redirect.ts` |
| 3.8 | OAuth state manager — generate/validate-and-consume/find-pending/purge-expired; 10-min TTL, single-use | `src/google/state.ts` |
| 3.9 | OAuth core — `buildAuthUrl`, `exchangeCode`, `refreshAccessToken`, `fetchUserEmail`; uses plain `fetch`, no googleapis SDK for auth | `src/google/oauth.ts` |
| 3.10 | Token store — persist tokens; refresh on demand (5-min buffer); reads client creds from `GoogleClientStore` | `src/google/token-store.ts` |
| 3.11 | Token redaction — extend `redact.ts` to strip `ya29.`, `1//`, `4/`, bearer headers, sensitive query params | `src/security/redact.ts` |
| 3.12 | `/google-setup` Telegram command — accept attached `client_secret.json`, parse, store | `src/telegram/commands/google.ts` |
| 3.13 | `/google-connect <email>` Telegram command — accept user's Google email, generate state+URI, build auth URL with `login_hint`, send instructions | `src/telegram/commands/google.ts` |
| 3.14 | `/google-complete` Telegram command — parse pasted URL, validate state, exchange code, store tokens | `src/telegram/commands/google.ts` |
| 3.15 | `/google-status` and `/google-disconnect` commands | `src/telegram/commands/google.ts` |
| 3.16 | Gmail normalizer — `CompactEmail` / `CompactEmailDetail`; prefers `text/plain`; caps snippet (300) and excerpt (2000) | `src/google/normalize-gmail.ts` |
| 3.17 | Gmail client — `listRecent` and `getMessage` using `Authorization: Bearer` header | `src/google/gmail.ts` |
| 3.18 | Calendar normalizer and client — `normalizeCalendarEvent`; `CalendarClient.listWindow` merges multiple calendars | `src/google/normalize-calendar.ts`, `src/google/calendar.ts` |
| 3.19 | Agent tools — `gmail_list_recent`, `gmail_get_message`, `calendar_list_today`, `calendar_list_tomorrow` | `src/tools/gmail-*.ts`, `src/tools/calendar-*.ts` |
| 3.20 | Tool registry — rebuild per agent turn; register Google tools only when `tokenStore.hasCredential()` | `src/agent/tool-registry.ts` |
| 3.21 | Bootstrap wiring — instantiate `GoogleClientStore`, `OAuthStateManager`, `GoogleOAuth`, `GoogleTokenStore`, `GmailClient`, `CalendarClient`; register Telegram commands; pass `buildTools` factory to agent runtime | `src/app/bootstrap.ts` |

**Exit criteria:** `/google-setup` (with Desktop `client_secret.json` attached) → `/google-connect user@gmail.com` (instructions + auth URL sent with `login_hint`) → browser consent → `/google-complete <url>` → "Connected as user@gmail.com" → `gmail_list_recent` available in the next agent turn without a service restart.

---

## Phase 4 — Scheduler + Daily Briefing

**Goal:** Run recurring jobs on schedule, deliver daily briefing to Telegram.

| # | Task | Key Files |
|---|------|-----------|
| 4.1 | Job and job-run stores | `src/storage/jobs.ts`, `src/storage/job-runs.ts` |
| 4.2 | Cron expression evaluator / next-run calculator | `src/scheduler/timing.ts` |
| 4.3 | Atomic job claim (claim token + expiry) | `src/scheduler/locks.ts` |
| 4.4 | Scheduler poll loop (wake every 15–30s) | `src/scheduler/service.ts`, `src/scheduler/runner.ts` |
| 4.5 | Briefing service (fetch + normalize + build prompt) | `src/services/briefing.ts`, `src/services/summarization.ts` |
| 4.6 | `daily_briefing` job handler | `src/scheduler/jobs/daily-briefing.ts` |
| 4.7 | `email_digest` job handler | `src/scheduler/jobs/email-digest.ts` |
| 4.8 | `calendar_briefing` job handler | `src/scheduler/jobs/calendar-briefing.ts` |
| 4.9 | Register job handlers in scheduler service | `src/scheduler/service.ts` |
| 4.10 | Telegram commands for scheduler management (`/jobs`, `/briefing`) | `src/telegram/handler.ts` |

**Exit criteria:** Daily briefing fires at configured time, delivers a message under 8,000 tokens to Telegram. Scheduler survives process restart without double-running.

---

## Phase 5 — Hardening + Deployment

**Goal:** Production-ready service on the Pi. Completes v1.

| # | Task | Key Files |
|---|------|-----------|
| 5.1 | Retry with backoff for Telegram polling failures | `src/telegram/polling.ts` |
| 5.2 | Tighter exec policy (denylist patterns, allowlist mode option) | `src/security/exec-policy.ts` |
| 5.3 | Repeated job failure → Telegram alert | `src/scheduler/runner.ts` |
| 5.4 | History truncation / compression (naive trim → smarter strategy) | `src/agent/history.ts` |
| 5.5 | `systemd` unit file | `systemd/tdmclaw.service` |
| 5.6 | Environment file template | `systemd/tdmclaw.env.example` |
| 5.7 | Unit tests: path guard, prompt builder, normalizers, scheduler timing | `src/**/*.test.ts` |
| 5.8 | Integration tests: agent loop with mock provider, OAuth callback | `tests/` |
| 5.9 | Deployment docs (Caddy/TLS setup, LAN OAuth, initial config) | `docs/` |
| 5.10 | CLI management tool — `tdmclaw config get/set`, `tdmclaw users add/remove <id>`, `tdmclaw status`; reads/writes `config.yaml` and SQLite directly | `src/cli/index.ts`, `src/cli/commands/` |

---

## Phase C-1 — Context Features: Shared Scaffolding

**Goal:** Add config flags, workspace template assets, and shared seeding/context assembly primitives. Detailed spec: `tdmClaw_ContextFeatures_IP.md`, `tdmClaw_ContextFeatures_TDD.md`.

| # | Task | Key Files |
|---|------|-----------|
| C-1.1 | Extend `AppConfig` with `personality`, `skills`, and `memories` sections | `src/app/config.ts`, `config/config.example.yaml` |
| C-1.2 | Add repo templates for personality and default skills | `templates/personality/*`, `templates/skills/*` |
| C-1.3 | Create workspace seeding helpers (create dirs, copy-if-missing) | `src/workspace/seeding.ts` |
| C-1.4 | Update bootstrap to seed personality and skills alongside jobs | `src/app/bootstrap.ts` |
| C-1.5 | Update `install.sh` to create directories and seed templates before first run | `install.sh` |
| C-1.6 | Create prompt context assembler contract and types | `src/context/assembler.ts`, `src/context/types.ts` |

**Exit criteria:** A fresh install or first bootstrap produces `<workspace>/personality` and `<workspace>/skills` with default files present; user-edited files are never overwritten.

---

## Phase C-2 — Context Features: Personality

**Goal:** Load operator-editable personality files from the workspace and inject them into the system prompt when enabled.

| # | Task | Key Files |
|---|------|-----------|
| C-2.1 | Implement personality loader for `PERSONALITY.md` and `USER.md` | `src/context/personality.ts` |
| C-2.2 | Add truncation and formatting rules for injected personality content | `src/context/personality.ts` |
| C-2.3 | Integrate personality block into prompt assembly | `src/context/assembler.ts`, `src/agent/prompt.ts`, `src/agent/runtime.ts` |
| C-2.4 | Add tests for enabled, disabled, missing-file, and oversized-file cases | `src/context/personality.test.ts`, `src/agent/prompt.test.ts` |

**Exit criteria:** Editing workspace personality files changes the next agent turn when `personality.enabled = true`; has no effect when disabled.

---

## Phase C-3 — Context Features: Skills

**Goal:** Discover workspace skills, match them to the current request, and inject only the relevant skill instructions.

| # | Task | Key Files |
|---|------|-----------|
| C-3.1 | Implement `SKILL.md` parser with YAML front matter support | `src/context/skills.ts` |
| C-3.2 | Implement skill directory discovery and validation | `src/context/skills.ts` |
| C-3.3 | Implement trigger scoring and top-N skill selection | `src/context/skills.ts` |
| C-3.4 | Implement built-in `requires` providers: `current_jobs`, `scheduler_rules`, `job_schema`, `current_skills` | `src/context/skill-requires.ts` |
| C-3.5 | Inject selected skills and required context into the prompt | `src/context/assembler.ts`, `src/agent/prompt.ts` |
| C-3.6 | Seed default `job_creation` and `skill_creation` skills | `templates/skills/job_creation/SKILL.md`, `templates/skills/skill_creation/SKILL.md` |
| C-3.7 | Add tests for trigger matching, malformed front matter, unknown `requires`, and prompt-size caps | `src/context/skills.test.ts` |

**Exit criteria:** A request like "add a recurring task" injects the `job_creation` skill automatically without injecting unrelated skills.

---

## Phase C-4 — Context Features: Memories

**Goal:** Add durable, bounded, SQLite-backed memories with explicit agent tools.

| # | Task | Key Files |
|---|------|-----------|
| C-4.1 | Add `memories` table migration | `src/storage/migrations.ts` |
| C-4.2 | Create memory DAO for CRUD and ranked search | `src/storage/memories.ts` |
| C-4.3 | Implement memory formatter and retrieval logic | `src/context/memories.ts` |
| C-4.4 | Add memory tools: `memory_list`, `memory_create`, `memory_update`, `memory_delete` | `src/tools/memory-*.ts` |
| C-4.5 | Register memory tools conditionally when `memories.enabled = true` | `src/agent/tool-registry.ts` |
| C-4.6 | Inject relevant memories into the prompt before each turn | `src/context/assembler.ts`, `src/agent/runtime.ts`, `src/agent/prompt.ts` |
| C-4.7 | Add tests for ranking, bounds, CRUD, and disabled mode | `src/storage/memories.test.ts`, `src/context/memories.test.ts`, `src/tools/memory-*.test.ts` |

**Exit criteria:** The agent can remember durable user facts through explicit tools and retrieve relevant memories on later turns without loading the entire table into the prompt.

---

## Phase C-5 — Context Features: Hardening and Polish

**Goal:** Tighten behavior, improve observability, and prepare the features for CLI support.

| # | Task | Key Files |
|---|------|-----------|
| C-5.1 | Add structured logging around skill selection and memory retrieval counts | `src/context/*.ts`, `src/agent/runtime.ts` |
| C-5.2 | Add redaction checks for memory writes containing obvious secret material | `src/tools/memory-create.ts`, `src/security/redact.ts` |
| C-5.3 | Add prompt-budget guards across personality, skills, and memories | `src/context/assembler.ts` |
| C-5.4 | Document workspace layout and config knobs in README | `README.md` |
| C-5.5 | Add future CLI hooks to the backlog: config toggles, memory inspection, skill listing | `tdmClaw_CLI_TDD.md`, `tdmClaw_CLI_IP.md` |

**Exit criteria:** Runtime logs show which context features were injected, prompt size stays bounded, features are documented for operator use.

---

## Key Design Decisions (Confirmed)

### Model Selection
Model selection is dynamic, not static config. The application polls the Ollama endpoint's `GET /api/tags` on startup and periodically thereafter. Config fields `models.model` and `models.fallbackModels` are optional hints. The active model and fallback chain are persisted in the `settings` SQLite table so selections survive restarts. Runtime management is via four Telegram commands: `/models`, `/model`, `/setmodel <name>`, `/setfallback <name...>`.

### Token encryption at rest
Deferred to Phase 5 hardening. In v1, Google OAuth tokens are stored in the SQLite `credentials` table with restricted file permissions. Encryption-at-rest is a Phase 5 improvement.

### Admin Telegram commands
Include `/google-connect`, `/jobs`, `/briefing` in v1 (Phase 4). Simpler than a UI and necessary for scheduler management.

### Calendar write
Post-v1. `calendar_create_event` is a Phase 5+ addition.

---

## Suggested Build Order Summary

```
Phase 1  (Foundation)                       ~1–2 days
Phase 2  (Telegram + Agent)                 ~3–5 days
Phase 3  (Google)                           ~2–3 days
Phase 4  (Scheduler)                        ~2–3 days
Phase 5  (Hardening + Deployment)  ← v1    ~2–3 days
───────── v1 complete ─────────────────────────────────
Phase C-1 (Context scaffolding)             ~0.5–1 day
Phase C-2 (Personality)                     ~0.5 day
Phase C-3 (Skills)                          ~1–1.5 days
Phase C-4 (Memories)                        ~1–1.5 days
Phase C-5 (Context hardening + polish)      ~0.5 day
```

---

## Acceptance Criteria for v1

Implementation is complete (Phase 5 done) when all of the following are true:

1. The service runs continuously on a Raspberry Pi as a background `systemd` service.
2. The owner can interact with it through Telegram.
3. The assistant can list available Ollama models and switch between them via Telegram.
4. The assistant can read and modify files in a configured workspace.
5. The assistant can execute bounded shell commands and return results.
6. The user can complete Google account authorization from any device with a browser.
7. The assistant can read recent Gmail messages.
8. The assistant can read upcoming Google Calendar events.
9. The assistant can run at least one recurring daily briefing job and deliver the result to Telegram.
10. The prompt footprint remains intentionally small and bounded.
11. The codebase remains understandable without requiring a plugin framework.

---

## Acceptance Criteria for Context Features (post-v1)

Context features are complete (Phase C-5 done) when all of the following are true:

1. The config file can enable or disable personality, skills, and memories independently.
2. Install and bootstrap both seed default personality and skill files safely (copy-if-missing only).
3. Personality files are reflected in the next agent turn when enabled.
4. Relevant skills are injected automatically based on user-request trigger matching.
5. Memories persist in SQLite and can be managed through explicit agent tools.
6. The prompt context remains bounded and explainable across all three features.
7. Disabling any feature returns the agent to baseline behavior without regressions.
