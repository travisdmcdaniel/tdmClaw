# tdmClaw Product Requirements Document

## Document Metadata

- Product Name: tdmClaw
- Document Type: Product Requirements Document
- Version: 0.1
- Status: Draft
- Target Platform: Headless Ubuntu Server on Raspberry Pi
- Primary Interface: Telegram
- Authoring Context: Derived from analysis of OpenClaw architecture and requirements for a smaller, Pi-first implementation

## 1. Executive Summary

tdmClaw is a lightweight, self-hosted AI assistant designed to run continuously as a service on a headless Ubuntu Server Raspberry Pi. It is inspired by OpenClaw, but intentionally narrower in scope and significantly smaller in token footprint, architecture, and operational complexity.

The initial release focuses on a single messaging channel, Telegram, and a small set of high-value capabilities:

- conversational assistance over Telegram
- limited local coding-agent behaviors such as reading files, writing files, applying patches, and executing commands
- access to Gmail and Google Calendar
- built-in scheduled jobs for daily briefings and automated email/calendar summaries

The core design principle is to preserve the useful behavior of a tool-using assistant while removing the prompt inflation, plugin complexity, and multi-channel abstractions that make larger systems like OpenClaw expensive for small local models.

tdmClaw should be able to work with locally hosted models running on or near the Raspberry Pi, or with remote APIs when needed. The architecture must strongly prefer low-token prompts, narrow tools, bounded outputs, and deterministic preprocessing of external data before handing it to the language model.

## 2. Product Vision

Build a personal, private, always-on assistant that:

- runs reliably on commodity home hardware
- communicates through Telegram
- can automate a small but useful set of local tasks
- can read and summarize Gmail and Google Calendar data
- can proactively send scheduled briefings and reminders
- stays understandable, auditable, and maintainable by a single developer

The product is explicitly not intended to match OpenClaw feature-for-feature. It should instead be a clean-room-style reduction of the idea into a system that is practical for a Raspberry Pi and understandable from the ground up.

## 3. Product Goals

### 3.1 Primary Goals

1. Provide a Telegram-first AI assistant that operates continuously as a background service.
2. Support a minimal but reliable tool-using agent loop.
3. Keep prompt and token usage small enough to work with compact local models.
4. Integrate Gmail and Google Calendar for search, summarization, and briefing workflows.
5. Include built-in job scheduling for proactive assistant behavior.
6. Keep the implementation small, explicit, and understandable.

### 3.2 Secondary Goals

1. Allow future expansion to additional tools or integrations without adopting a large plugin framework.
2. Support both local-model and remote-model backends behind a small provider abstraction.
3. Preserve user privacy through self-hosting and minimized external dependencies.

### 3.3 Non-Goals for Initial Release

1. Multi-channel support beyond Telegram.
2. General plugin marketplace compatibility.
3. Multi-user SaaS-style account support.
4. Rich web UI.
5. Full browser automation.
6. Large memory/retrieval systems.
7. Generalized cron tooling exposed directly to the model.
8. Multi-agent orchestration and subagents.
9. Enterprise-grade collaborative features.

## 4. Background and Rationale

OpenClaw demonstrates that a messaging-first assistant can combine conversation, local tools, and integrations. However, OpenClaw includes a large amount of functionality that is useful for a broad product but costly for a small local deployment:

- multi-channel abstractions
- plugin discovery and runtime loading
- large system prompts
- workspace bootstrap file injection
- memory and compaction layers
- rich tool catalogs
- dynamic routing and approval surfaces

For tdmClaw, the product strategy is to keep the architecture close to the essential flow:

1. receive a Telegram message
2. normalize it into a session context
3. build a very small prompt
4. expose a narrow set of tools
5. loop model -> tool -> model until completion
6. reply over Telegram

Google services and scheduling will be implemented as first-class product features, not generic plugin skills.

## 5. Users and Use Cases

## 5.1 Primary User

The primary user is the owner/operator of the Raspberry Pi who:

- wants a private assistant available in Telegram
- wants scheduled daily summaries and reminders
- wants basic coding-agent functionality
- is comfortable with self-hosting and light system administration

## 5.2 Core Use Cases

1. Ask the assistant questions or request simple task execution over Telegram.
2. Ask the assistant to inspect or modify files in a defined workspace.
3. Ask the assistant to run shell commands inside constrained boundaries.
4. Ask the assistant to summarize recent Gmail messages.
5. Ask the assistant to check upcoming Google Calendar events.
6. Receive a daily morning briefing via Telegram combining Gmail and Calendar.
7. Receive reminders or summaries on a recurring schedule.

## 6. Product Principles

## 6.1 Pi-First

The product must be designed for constrained hardware from the beginning. This affects:

- prompt size
- tool design
- history retention
- output truncation
- scheduling strategy
- model backend selection

## 6.2 Narrow Interfaces

The model should not receive broad access to systems when narrow task-specific interfaces are sufficient. For example:

- prefer `gmail.list_recent` over exposing a generic Google CLI
- prefer `calendar.list_today` over full arbitrary API surfaces
- prefer `read_file(path, start, limit)` over unrestricted file dumps

## 6.3 Deterministic Preprocessing

External data such as emails and calendar events should be normalized and compressed by application code before inclusion in prompts. The model should summarize and reason over structured inputs, not raw API payloads.

## 6.4 Explicit Boundaries

The system should favor simple, obvious boundaries:

- one channel adapter
- one agent loop
- one scheduler
- one Google connector
- one storage layer

## 6.5 Operability Over Cleverness

Reliability and debuggability are more important than maximum autonomy.

## 7. Success Metrics

## 7.1 Functional Success Metrics

1. User can send a Telegram message and receive a valid assistant response.
2. Assistant can read and modify files inside a configured workspace.
3. Assistant can execute bounded shell commands and return output.
4. User can complete Google account authorization from any device with a browser.
5. Assistant can retrieve Gmail and Calendar data after authorization.
6. Daily briefing job runs automatically and sends a Telegram message at the configured time.

## 7.2 Quality Metrics

1. Median prompt size for standard chat turn remains under 4,000 tokens.
2. Median prompt size for daily briefing remains under 8,000 tokens.
3. End-to-end Telegram response time for simple requests is acceptable on Raspberry Pi-class hardware.
4. Scheduler survives process restart without losing job definitions.
5. OAuth refresh tokens survive reboot and reauthorization is infrequent.

## 7.3 Operational Metrics

1. Service starts automatically on boot.
2. Service can run for days without manual intervention.
3. Logs are sufficient to debug failed tool calls, failed jobs, and failed Google auth refreshes.

## 8. High-Level Product Scope

## 8.1 In Scope for v1

- Telegram messaging bot
- session tracking
- local tool-using assistant loop
- small prompt composition layer
- local file tools
- local command execution tool
- Google OAuth authorization flow for LAN users
- Gmail read/summarize flows
- Google Calendar read flows
- built-in recurring jobs
- daily Telegram briefings
- SQLite persistence
- systemd service deployment on Ubuntu Server

## 8.2 Out of Scope for v1

- Discord, Slack, Signal, web, email, or any other channel
- generic skills marketplace
- OpenClaw compatibility
- dynamic plugin installation
- multi-tenant account model
- cloud dashboard
- public internet callback hosting
- generalized workflow builder

## 9. System Overview

tdmClaw consists of six main subsystems:

1. Telegram Gateway
2. Agent Runtime
3. Tool Runtime
4. Google Connector
5. Scheduler
6. Persistence Layer

### 9.1 Telegram Gateway

Responsibilities:

- poll or receive webhooks from Telegram
- authenticate sender identity against configured allowlists
- map incoming messages to a session
- pass normalized requests to the Agent Runtime
- send replies and scheduled messages back to Telegram

### 9.2 Agent Runtime

Responsibilities:

- build the system prompt
- load bounded recent conversation history
- expose allowed tools
- call the configured LLM backend (Ollama by default)
- execute tool calls
- manage loop termination
- generate final assistant response

### 9.3 Tool Runtime

Responsibilities:

- implement local file and command tools
- validate inputs
- enforce workspace boundaries
- truncate and sanitize outputs
- return structured results to the agent loop

### 9.4 Google Connector

Responsibilities:

- handle OAuth authorization
- store and refresh Google tokens
- query Gmail and Calendar
- normalize external data into compact internal representations

### 9.5 Scheduler

Responsibilities:

- persist recurring jobs
- compute next-run times
- execute job handlers
- deliver results via Telegram
- record run history and failures

### 9.6 Persistence Layer

Responsibilities:

- store sessions
- store job definitions
- store job run history
- store Google credentials metadata
- store assistant configuration

## 10. User Experience Requirements

## 10.1 Telegram Conversational UX

The assistant should behave as a direct Telegram chat participant.

Requirements:

- replies must be concise by default
- long tool output must be summarized or truncated
- errors must be understandable
- no raw stack traces should be sent to the user
- Telegram remains the primary control plane for everyday use

## 10.2 Authentication UX for Google

The assistant uses a **loopback manual flow** that requires no HTTP server, LAN hostname, or HTTPS termination:

1. The user uploads `client_secret.json` once via `/google-setup`.
2. The user runs `/google-connect their@gmail.com` in Telegram.
3. The assistant sends an authorization URL (pre-populated with `login_hint` for the provided email).
4. The user opens the URL in any browser on any device, approves the consent screen.
5. The browser fails to connect to `127.0.0.1` — this is expected. The authorization code is visible in the address bar.
6. The user copies the URL and sends it back via `/google-complete <url>`.
7. The assistant confirms connection in Telegram.

This flow works from any device with a browser and requires no network setup on the Pi.

## 10.3 Scheduler UX

The user should be able to:

- enable a daily briefing
- change the briefing time
- pause or resume recurring jobs
- request a one-time manual run
- receive success or failure notifications in Telegram

Initial scheduler management may be implemented through Telegram commands rather than a UI.

## 11. Functional Requirements

## 11.1 Telegram Integration

### FR-TG-1

The system shall support Telegram bot polling mode as the default transport.

### FR-TG-2

The system shall accept messages only from explicitly allowed chats and/or users.

### FR-TG-3

The system shall map each Telegram conversation to a stable session identifier.

### FR-TG-4

The system shall send plain text responses to Telegram.

### FR-TG-5

The system should support basic reply-to behavior when appropriate.

## 11.2 Agent Loop

### FR-AG-1

The system shall construct a compact system prompt for each turn.

### FR-AG-2

The system shall include only a bounded number of recent history turns.

### FR-AG-3

The system shall expose only explicitly enabled tools.

### FR-AG-4

The system shall support an iterative tool loop:

- send prompt and tools to model
- detect requested tool call
- execute tool
- append tool result
- continue until final assistant message or loop limit reached

### FR-AG-5

The system shall enforce a maximum tool-iteration count per turn.

### FR-AG-6

The system shall support both local-model and remote-model providers through a small provider abstraction.

## 11.3 File and Workspace Tools

### FR-FS-1

The assistant shall support reading files within a configured workspace root.

### FR-FS-2

The assistant shall support listing files within a configured workspace root.

### FR-FS-3

The assistant shall support writing files within a configured workspace root.

### FR-FS-4

The assistant shall support patch-based edits to files within the workspace root.

### FR-FS-5

The assistant shall reject file operations outside the workspace root unless explicitly configured otherwise.

## 11.4 Command Execution

### FR-EX-1

The assistant shall support shell command execution on the host.

### FR-EX-2

The execution subsystem shall enforce configurable safety policy:

- allowed working directories
- optional allowlists/denylists
- max runtime
- max output

### FR-EX-3

The execution subsystem should support a mode where dangerous commands require explicit approval.

### FR-EX-4

The execution subsystem shall return truncated stdout/stderr rather than unlimited output.

## 11.5 Gmail Integration

### FR-GM-1

The system shall support Google account authorization with offline access.

### FR-GM-2

The system shall store refresh-capable credentials securely enough for a personal self-hosted deployment.

### FR-GM-3

The system shall support listing recent messages from Gmail.

### FR-GM-4

The system shall support reading message metadata and compact text extracts.

### FR-GM-5

The system shall support summarization-oriented email retrieval for scheduled jobs.

### FR-GM-6

The system should support label-based filtering and timeframe filters.

## 11.6 Google Calendar Integration

### FR-GC-1

The system shall support listing upcoming calendar events.

### FR-GC-2

The system shall support retrieving events for today and tomorrow.

### FR-GC-3

The system should support calendar event creation in a later milestone.

## 11.7 Scheduler

### FR-SC-1

The system shall support recurring scheduled jobs.

### FR-SC-2

The system shall persist job definitions across restarts.

### FR-SC-3

The system shall persist job run history.

### FR-SC-4

The system shall support at least the following built-in job types:

- daily_briefing
- email_digest
- calendar_briefing

### FR-SC-5

The system shall deliver scheduled job output through Telegram.

### FR-SC-6

The scheduler shall avoid duplicate execution after process restart.

## 12. Non-Functional Requirements

## 12.1 Performance

1. The service must run on Raspberry Pi-class hardware without requiring cloud-only infrastructure.
2. Prompt construction must remain lightweight.
3. Gmail and Calendar preprocessing should be mostly deterministic application logic, not LLM logic.

## 12.2 Reliability

1. The bot should recover from Telegram polling interruptions.
2. The scheduler should resume after restart.
3. Token refresh should occur automatically where possible.

## 12.3 Security

1. Credentials must not be exposed in Telegram replies.
2. Workspace tools must enforce root boundaries.
3. Command execution must be policy-constrained.
4. The loopback manual OAuth flow requires no inbound HTTPS — CSRF protection is provided by cryptographically random state tokens with a 10-minute TTL.

## 12.4 Maintainability

1. Keep the codebase small and modular.
2. Avoid large dynamic plugin systems in v1.
3. Favor explicit internal interfaces over generic extension points.

## 13. Architecture Requirements

## 13.1 Recommended Technology Stack

- Language: TypeScript
- Runtime: Node.js 22+
- Telegram library: `grammy`
- HTTP server: `Fastify`, `Hono`, or `Express` with minimal middleware
- Validation: `zod` or `@sinclair/typebox`
- Persistence: SQLite
- Scheduling: in-process scheduler backed by SQLite
- Process management: `systemd`

## 13.2 Recommended Project Structure

```text
tdmclaw/
  src/
    app/
      config.ts
      logger.ts
      env.ts
    telegram/
      bot.ts
      polling.ts
      handlers.ts
      formatting.ts
    agent/
      runtime.ts
      prompt.ts
      history.ts
      session.ts
      providers/
        types.ts
        openai-compatible.ts
        local.ts
      tools/
        registry.ts
        read-file.ts
        write-file.ts
        list-files.ts
        exec.ts
        apply-patch.ts
    google/
      oauth.ts
      token-store.ts
      gmail.ts
      calendar.ts
      summarizers.ts
    scheduler/
      service.ts
      jobs.ts
      timing.ts
      runner.ts
    storage/
      db.ts
      migrations.ts
      sessions.ts
      jobs.ts
      credentials.ts
    api/
      auth-server.ts
      google-callback.ts
    services/
      daily-briefing.ts
      email-digest.ts
      calendar-briefing.ts
    index.ts
  systemd/
    tdmclaw.service
  docs/
  tdmClaw_PRD.md
```

## 13.3 Deployment Model

The service runs continuously on a Raspberry Pi using `systemd`.

Supporting processes may include:

- the tdmClaw Node.js service
- a local model server, if applicable
- a local model server, if applicable (no reverse proxy needed for OAuth)

## 14. Assistant Runtime Design

## 14.1 Minimal Prompt Strategy

The prompt must remain intentionally small.

The base system prompt should include only:

- assistant identity
- operating constraints
- summary of available tools
- workspace boundary rules
- safety rules
- response style guidance

The prompt should exclude by default:

- large bootstrap file injection
- skill inventories
- long memory instructions
- large docs excerpts
- dynamic product-wide guidance

## 14.2 History Strategy

The session strategy should prefer:

- last 4 to 8 turns
- truncation over elaborate compaction in v1
- optional one-paragraph summary of older context in later milestones

## 14.3 Tool Loop Strategy

Each turn should allow a bounded number of tool iterations.

Recommended default:

- max 4 tool calls per turn for local models
- optionally configurable to 8 for remote models

If the limit is exceeded:

- stop
- return a graceful assistant message
- optionally recommend the user narrow the request

## 14.4 Tool Output Budgeting

All tools must use bounded output.

Recommended defaults:

- file reads: cap by character or line count
- command output: cap to 2-4 KB
- Gmail summaries: extract compact fields only
- Calendar summaries: compact event payloads only

## 15. Tool Requirements

## 15.1 `read_file`

Inputs:

- path
- optional start line
- optional max lines

Behavior:

- read file under workspace root
- return bounded excerpt

## 15.2 `list_files`

Inputs:

- path
- optional recursion depth

Behavior:

- return compact file listing

## 15.3 `write_file`

Inputs:

- path
- content
- optional overwrite mode

Behavior:

- write within workspace root only

## 15.4 `apply_patch`

Inputs:

- structured patch text

Behavior:

- modify files inside workspace root
- reject out-of-root paths

## 15.5 `exec`

Inputs:

- command
- optional working directory
- optional timeout

Behavior:

- execute under safety constraints
- capture stdout/stderr
- truncate output

## 15.6 Google-Facing Tools

These should be narrow internal tools, not generic API passthroughs.

Recommended initial set:

- `gmail_list_recent`
- `gmail_get_message`
- `calendar_list_today`
- `calendar_list_tomorrow`

Possible later additions:

- `calendar_create_event`
- `gmail_search`
- `gmail_draft_reply`

## 16. Google Integration Requirements

## 16.1 Preferred Integration Approach

The preferred implementation is direct Google API integration inside tdmClaw rather than dependency on an external skill/CLI stack.

Rationale:

- simpler architecture
- better control over bounded outputs
- better prompt efficiency
- fewer moving parts

## 16.2 OAuth Flow Requirements

The product must support the loopback manual flow requiring no HTTP callback server.

Production flow:

1. User uploads `client_secret.json` once via `/google-setup` (Telegram document attachment).
2. User runs `/google-connect their@gmail.com` in Telegram.
3. Assistant creates a stateful OAuth session and sends an authorization URL with `login_hint`.
4. User opens the URL in any browser, approves consent.
5. Browser fails to connect to loopback address — code is visible in address bar.
6. User copies URL and sends it back via `/google-complete <url>`.
7. Assistant validates state, exchanges code for tokens, confirms in Telegram.

## 16.3 Callback Requirements

The loopback manual flow has no network callback requirements:

- No HTTP server is needed for OAuth.
- No LAN hostname or DNS entry is required.
- No HTTPS certificate or reverse proxy is needed.
- The redirect URI is an ephemeral loopback address (`http://127.0.0.1:<port>/...`) that nothing listens on.
- The only user action beyond browser approval is one copy-paste of the failed redirect URL.

## 16.4 Token Storage Requirements

The system shall store:

- access token metadata
- refresh token
- granted scopes
- token expiry info

Storage should be:

- file- or SQLite-based
- permission-restricted
- not exposed in chat output

## 16.5 Gmail Data Normalization

Raw Gmail API responses must be normalized into compact internal objects such as:

```ts
type CompactEmail = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  excerpt?: string;
  labels?: string[];
};
```

The assistant should reason over compact email objects, not raw MIME structures.

## 16.6 Calendar Data Normalization

Raw Calendar API responses must be normalized into compact internal objects such as:

```ts
type CompactCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  descriptionExcerpt?: string;
  calendarId?: string;
};
```

## 17. Scheduler Requirements

## 17.1 Product Behavior

The scheduler is a product feature, not an initial LLM tool.

Users should be able to configure a few built-in recurring behaviors such as:

- morning daily briefing
- end-of-day email summary
- pre-meeting reminder

## 17.2 Job Types

### `daily_briefing`

Inputs:

- time
- timezone
- email lookback window
- included calendars
- Telegram destination

Output:

- morning summary message via Telegram

### `email_digest`

Inputs:

- schedule
- Gmail filters
- max emails

Output:

- summarized digest via Telegram

### `calendar_briefing`

Inputs:

- schedule
- day window
- calendar selection

Output:

- event summary via Telegram

## 17.3 Scheduling Semantics

Requirements:

- use local timezone
- persist `next_run_at`
- handle restarts cleanly
- avoid double-runs after crash/restart

## 17.4 Run History

Each run should record:

- job id
- started_at
- finished_at
- status
- summary
- error if any

## 18. Daily Briefing Product Definition

The daily briefing is a flagship feature.

## 18.1 Inputs

- Gmail messages from the previous 24 hours or configured lookback window
- Calendar events for the current day
- optional user preferences such as verbosity

## 18.2 Processing Flow

1. fetch recent Gmail items
2. fetch today’s calendar events
3. normalize into compact objects
4. optionally classify emails heuristically before LLM use
5. build a short briefing prompt
6. ask the model to produce a concise briefing
7. send result to Telegram

## 18.3 Expected Output Shape

Recommended briefing structure:

- Today’s schedule
- Important emails
- Action items
- Conflicts or deadlines

## 18.4 Token Budget Strategy

The briefing pipeline must aggressively preprocess before invoking the model:

- cap number of emails
- dedupe by thread where possible
- strip HTML
- limit excerpts
- limit calendar payload size

## 19. Data Model Requirements

## 19.1 Sessions

Suggested fields:

- `id`
- `telegram_chat_id`
- `telegram_user_id`
- `created_at`
- `updated_at`
- `summary`

## 19.2 Messages

Suggested fields:

- `id`
- `session_id`
- `role`
- `content`
- `created_at`

## 19.3 Jobs

Suggested fields:

- `id`
- `name`
- `type`
- `enabled`
- `schedule`
- `timezone`
- `payload_json`
- `last_run_at`
- `next_run_at`
- `created_at`
- `updated_at`

## 19.4 Job Runs

Suggested fields:

- `id`
- `job_id`
- `started_at`
- `finished_at`
- `status`
- `result_summary`
- `error_text`

## 19.5 Credentials

Suggested fields:

- `provider`
- `account_label`
- `scopes`
- `token_blob`
- `created_at`
- `updated_at`

## 20. Security Requirements

## 20.1 Telegram Security

- Only configured users/chats may interact with the assistant.
- Unknown senders must be rejected silently or with a minimal denial message.

## 20.2 Workspace Security

- File operations must be restricted to configured roots.
- Path traversal must be rejected.

## 20.3 Command Security

- Dangerous commands should be blocked or require explicit approval.
- Maximum runtime and output size must be enforced.

## 20.4 OAuth Security

- Store tokens with restricted file permissions.
- Validate OAuth state tokens.
- Never emit refresh tokens to logs or Telegram.

## 20.5 Logging Security

- logs should redact secrets
- logs should avoid raw email content unless debug mode is explicitly enabled

## 21. Observability Requirements

The system should log:

- Telegram inbound and outbound events
- agent loop starts and completions
- tool invocations and outcomes
- scheduler job starts and outcomes
- Google auth and token refresh failures

The system should not log:

- secrets
- full token values
- unnecessary raw email bodies in normal mode

## 22. Configuration Requirements

Configuration should be file-based and environment-variable-overridable.

Suggested top-level config domains:

- Telegram
- Model provider
- Workspace
- Scheduler
- Google auth
- Logging
- Security policy

Example conceptual config:

```yaml
telegram:
  botToken: env:TELEGRAM_BOT_TOKEN
  allowedUsers:
    - "123456789"

workspace:
  root: /opt/tdmclaw/workspace

models:
  provider: local-openai-compatible
  baseUrl: http://127.0.0.1:11434/v1
  model: qwen2.5-coder-7b-instruct
  maxToolIterations: 4

google:
  enabled: true
  scopes:
    gmailRead: true
    calendarRead: true

scheduler:
  timezone: America/New_York

security:
  execApprovalMode: owner-only
  execTimeoutSeconds: 30
```

## 23. Deployment Requirements

## 23.1 Runtime Environment

- Ubuntu Server on Raspberry Pi
- Node.js 22+
- systemd
- SQLite

## 23.2 Service Management

The product must include:

- a `systemd` service file
- startup instructions
- restart-on-failure behavior
- environment file support

## 23.3 Google OAuth Deployment Notes

No local HTTPS listener, LAN hostname, or certificate is needed. The loopback manual flow works entirely through Telegram messages and a browser copy-paste. The only setup step is uploading `client_secret.json` via `/google-setup` and running `/google-connect <email>` once per Google account.

## 24. Error Handling Requirements

## 24.1 Telegram Errors

- polling failures should retry with backoff
- delivery failures should be logged and surfaced minimally

## 24.2 Model Errors

- model timeout should produce a concise failure reply
- context overflow should trigger a smaller retry strategy when feasible

## 24.3 Google Errors

- expired auth should result in reauthorization instructions
- Gmail/Calendar API errors should be logged with enough context to debug

## 24.4 Scheduler Errors

- failed jobs should be recorded in run history
- repeated job failures may optionally trigger Telegram alerts

## 25. Future Extensibility

The architecture should leave room for:

- additional integrations
- richer Telegram commands
- optional calendar event creation
- optional email drafting
- optional small retrieval/memory layer
- optional web admin UI

However, extensibility should be added only after the core system is stable.

## 26. Risks and Mitigations

## 26.1 Risk: Local Model Capability Limits

Small local models may struggle with long tool loops or complex prompts.

Mitigation:

- keep tool set small
- keep prompts compact
- cap iterations
- preprocess external data deterministically

## 26.2 Risk: OAuth Setup Complexity

Google authorization requires a one-time setup (uploading `client_secret.json` and running `/google-connect`).

Mitigation:

- loopback manual flow eliminates all network requirements
- `/google-setup` validates the uploaded file with clear error messages
- `/google-connect <email>` pre-selects the account via `login_hint`
- `/google-status` shows current authorization state at any time

## 26.3 Risk: Dangerous Command Execution

Any exec-capable assistant can become unsafe if constraints are weak.

Mitigation:

- workspace boundaries
- explicit policy controls
- bounded execution
- optional approval flow

## 26.4 Risk: Scheduler Duplication or Drift

Poor scheduling logic can cause missed or duplicated job runs.

Mitigation:

- persist next-run state
- lock job execution
- record run history
- test restart scenarios

## 27. Milestones

## Milestone 1: Core Telegram Assistant

- Telegram polling bot
- session store
- minimal prompt
- local model provider support
- file tools
- exec tool

## Milestone 2: Google Integration

- OAuth flow
- token storage
- Gmail recent-message access
- Calendar event listing

## Milestone 3: Scheduler and Briefings

- SQLite-backed scheduler
- daily briefing job
- job run history
- Telegram notifications

## Milestone 4: Hardening

- better command policies
- failure alerts
- improved summarization
- service packaging and docs

## 28. Acceptance Criteria for v1

tdmClaw v1 is complete when all of the following are true:

1. It runs continuously on a Raspberry Pi as a background service.
2. The owner can interact with it through Telegram.
3. It can read and modify files in a configured workspace.
4. It can execute bounded shell commands and return results.
5. It can complete Google account authorization from any device with a browser.
6. It can read recent Gmail messages.
7. It can read upcoming Google Calendar events.
8. It can run at least one recurring daily briefing job and deliver the result to Telegram.
9. Its prompt footprint remains intentionally small and bounded relative to OpenClaw.
10. The codebase remains understandable without requiring a plugin framework.

## 29. Recommended First Build Order

1. Telegram bot and session plumbing
2. minimal agent loop with local model backend
3. read/list/write/apply_patch/exec tools
4. SQLite persistence
5. direct Google OAuth
6. Gmail compact retrieval
7. Calendar compact retrieval
8. scheduler
9. daily briefing
10. hardening and deployment

## 30. Final Product Statement

tdmClaw should be the smallest system that meaningfully captures the practical value of OpenClaw for a single self-hosted user:

- one channel
- one assistant loop
- one bounded toolset
- one private deployment target
- one useful automation layer

Its job is not to be a universal framework. Its job is to be a reliable personal assistant that can run on a Raspberry Pi without dragging a large product architecture behind it.
