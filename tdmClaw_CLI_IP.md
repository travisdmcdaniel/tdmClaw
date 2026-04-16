# tdmClaw CLI Implementation Plan

## Document Metadata

- Project: tdmClaw
- Document Type: Implementation Plan — CLI Subsystem
- Version: 0.1
- Status: Active
- Related Documents: `tdmClaw_CLI_TDD.md`, `tdmClaw_IP.md`

---

## Prerequisites

- Phase 2 of the main plan is complete (config loader, DB, DAOs all exist).
- `commander` is added to `package.json` dependencies.
- The `bin` entry and shebang in `src/index.ts` are already in place (done in Phase 5 prep).

---

## Phase CLI-1 — Scaffolding and Core Infrastructure

**Goal:** Wire the entry dispatch, build the CLI skeleton with `commander`, establish `CliContext`, and implement the config read/write engine. No user-facing commands yet.

| # | Task | Key Files |
|---|------|-----------|
| 1.1 | Add `commander` to `package.json` dependencies | `package.json` |
| 1.2 | Update `src/index.ts` to dispatch on `process.argv[2]`: no arg or `start` → service bootstrap; anything else → CLI runtime | `src/index.ts` |
| 1.3 | Create CLI entry: root `commander` program with `--version`, `--config <path>`, `--json` global options; top-level `--help` output | `src/cli/index.ts` |
| 1.4 | Create `CliContext` builder: loads config (respecting `--config` override and `TDMCLAW_CONFIG_PATH`), opens DB read-only if it exists, surfaces `jsonMode` flag | `src/cli/context.ts` |
| 1.5 | Create output helpers: `printLine`, `printTable`, `printJson`, `die` (stderr + exit 1), `warn` | `src/cli/output.ts` |
| 1.6 | Create config document reader: `readConfigDocument()` using `yaml.parseDocument()` for comment-preserving access | `src/cli/config-file.ts` |
| 1.7 | Create config document writer: `setScalarValue(doc, keyPath, value)`, `backupConfig(path)`, `writeConfigDocument(path, doc)` | `src/cli/config-file.ts` |
| 1.8 | Unit tests: dispatch logic; `CliContext` builds correctly for missing DB; config round-trip preserves a comment | `src/cli/index.test.ts`, `src/cli/config-file.test.ts` |

**Exit criteria:** `tdmclaw --help` prints the dispatch hint. `tdmclaw start` starts the service. `tdmclaw foobar` routes to the CLI and prints "unknown command: foobar".

---

## Phase CLI-2 — Config and User Management Commands

**Goal:** Implement `config get/set/list` and `users list/add/remove`. These are the highest-value commands and operate entirely on config.yaml without touching the database.

| # | Task | Key Files |
|---|------|-----------|
| 2.1 | `config get <key>`: walk dotted key path in parsed YAML document; print scalar or array entries one per line; `--json` mode | `src/cli/commands/config.ts` |
| 2.2 | `config list`: enumerate all leaf keys and values; redact fields named `token`, `secret`, `apiKey` | `src/cli/commands/config.ts` |
| 2.3 | `config set <key> <value>`: validate key is not an array node; backup config; write scalar via `setScalarValue`; confirm output | `src/cli/commands/config.ts` |
| 2.4 | `users list`: read `telegram.allowedUserIds` sequence; print one per line; `--json` mode | `src/cli/commands/users.ts` |
| 2.5 | `users add <id>`: validate ID is digits-only; check for duplicate; append to sequence; backup and write config; confirm output | `src/cli/commands/users.ts` |
| 2.6 | `users remove <id>`: find and remove ID from sequence; block if it would leave the list empty; backup and write config; confirm output | `src/cli/commands/users.ts` |
| 2.7 | Unit tests: `config get` for scalar, array, nested, and unknown keys; `config set` round-trip; `users add` duplicate; `users remove` last-user guard | `src/cli/commands/config.test.ts`, `src/cli/commands/users.test.ts` |
| 2.8 | Integration test: `users add` → `users list` → `users remove` full round-trip on a temp config copy | `src/cli/commands/users.test.ts` |

**Exit criteria:** `tdmclaw users add 999` appends the ID to config.yaml and confirms success. `tdmclaw config set app.logLevel debug` writes the new value and the original comments are intact.

---

## Phase CLI-3 — Status and Model Commands

**Goal:** Implement `status`, `model get`, and `model set`. These commands require reading from SQLite and provide a quick health check for the running installation.

| # | Task | Key Files |
|---|------|-----------|
| 3.1 | `status`: load config; attempt to open DB (graceful if missing); read active model from `settings` table; read Google credential label from `credentials` table; count sessions; count jobs; print summary | `src/cli/commands/status.ts` |
| 3.2 | `status --json`: emit all fields as JSON object | `src/cli/commands/status.ts` |
| 3.3 | `model get`: open DB read-only; read `model.active` and `model.fallbacks` from `settings` table; fall back to config values if absent; print result | `src/cli/commands/model.ts` |
| 3.4 | `model set <name>`: open DB read-write; upsert `model.active` in `settings` table; print confirmation and restart reminder | `src/cli/commands/model.ts` |
| 3.5 | Unit tests: `status` with a seeded test database; `model get` falls back to config when DB is empty; `model set` writes correct row | `src/cli/commands/status.test.ts`, `src/cli/commands/model.test.ts` |

**Exit criteria:** `tdmclaw status` prints a full summary on a configured installation. `tdmclaw model set llama3.2` updates the DB row; `tdmclaw model get` reflects the change immediately.

---

## Phase CLI-4 — Jobs Commands (after Phase 4 of main plan)

**Goal:** Implement `jobs list` and `jobs run`. These depend on the `scheduled_jobs` and `job_runs` tables created in Phase 4 of the main plan.

| # | Task | Key Files |
|---|------|-----------|
| 4.1 | `jobs list`: read all rows from `scheduled_jobs` joined with most recent `job_runs` entry; print as table (name, enabled, schedule, last run, status); `--json` mode | `src/cli/commands/jobs.ts` |
| 4.2 | `jobs run <name>`: look up job by name; require service to be stopped (check lock via claim token logic or a simple advisory mechanism); invoke job handler directly in a minimal runtime context | `src/cli/commands/jobs.ts` |
| 4.3 | Unit tests: `jobs list` with a seeded jobs table; `jobs run` invokes the correct handler | `src/cli/commands/jobs.test.ts` |

**Exit criteria:** `tdmclaw jobs list` shows all scheduled jobs with their last run status. `tdmclaw jobs run daily_briefing` executes the briefing job and prints the result.

---

## Phase CLI-5 — Polish and Hardening

**Goal:** Tighten error messages, add missing edge case handling, improve help text, add a few convenience aliases.

| # | Task | Key Files |
|---|------|-----------|
| 5.1 | Improve all error messages to be specific and include remediation hints | all `src/cli/commands/` |
| 5.2 | Add `--dry-run` flag to `config set`, `users add`, `users remove`: print what would change without writing | `src/cli/commands/config.ts`, `src/cli/commands/users.ts` |
| 5.3 | Add `tdmclaw config set` type coercion for booleans and integers (infer from schema or YAML type of existing value) | `src/cli/config-file.ts` |
| 5.4 | Ensure all commands handle a missing or unreadable config.yaml with a clear error before attempting any further work | `src/cli/context.ts` |
| 5.5 | Update README "Quick Start" and "Configuration Reference" sections to document CLI commands | `README.md` |
| 5.6 | Update `tdmClaw_CLI_TDD.md` version to 1.0, status to Final | `tdmClaw_CLI_TDD.md` |

**Exit criteria:** All CLI commands produce specific, actionable errors for every documented error condition. `--dry-run` on a write command prints a preview without modifying any file.

---

## Key Design Decisions

### Single Binary Dispatch

The CLI shares the `tdmclaw` binary with the service via `process.argv` dispatch. This avoids introducing a second `bin` entry (like `tdmclaw-admin`) and keeps the user-facing command surface minimal. The service is still the default behavior when called with no arguments, so existing scripts and systemd units are unaffected.

### Comment-Preserving YAML Writes

The `yaml` package's `Document` API is used for all config writes. This is non-negotiable: if the config file's comments are destroyed on first `users add`, users will lose their inline documentation and distrust the CLI. The `yaml` package (already in the project) supports this without any additional dependency.

### No Service-Layer Imports

The CLI must not import `bootstrap.ts`, `bot.ts`, `polling.ts`, or any other service-layer module. Importing them would risk triggering side effects (database writes, network connections) or pulling in heavy dependencies for what should be a fast CLI command. Each command accesses the minimum required modules: config loader and (optionally) specific DAO methods.

### Read-Only DB for Query Commands

All commands that only read state open the database in `readonly` mode. This means a running service and a concurrent `tdmclaw status` will not contend for locks. Write commands (`model set`) acquire a single short-lived write statement, which is safe in WAL mode.

---

## Suggested Build Order

```
CLI-1 (Scaffolding)      ~0.5 days
CLI-2 (Config + Users)   ~1 day
CLI-3 (Status + Model)   ~0.5 days
CLI-4 (Jobs)             ~0.5 days  (after main Phase 4)
CLI-5 (Polish)           ~0.5 days
```

---

## Acceptance Criteria

The CLI implementation is complete when all of the following are true:

1. `tdmclaw users add <id>` and `tdmclaw users remove <id>` modify config.yaml without destroying comments or formatting.
2. `tdmclaw config get` and `tdmclaw config set` work for all scalar keys in the config schema.
3. `tdmclaw status` prints a useful summary whether the service is running or not.
4. `tdmclaw model get/set` read and write the active model in SQLite.
5. `tdmclaw jobs list` shows all scheduled jobs and their last-run status.
6. All commands exit 0 on success and non-zero on failure, with specific error messages.
7. All commands support `--json` for machine-readable output.
8. Running `tdmclaw` with no arguments still starts the service (no regression).
