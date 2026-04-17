# tdmClaw Context Features Implementation Plan

## Document Metadata

- Project: tdmClaw
- Document Type: Implementation Plan — Personality, Skills, and Memories
- Version: 0.1
- Status: Active
- Related Documents: `tdmClaw_ContextFeatures_TDD.md`, `tdmClaw_TDD.md`, `tdmClaw_IP.md`

---

## Prerequisites

- Main Phases 1 through 4 are already complete.
- Workspace upload handling and job-file seeding already exist and can be reused.
- The CLI is not required for the first implementation, but config shape should be CLI-friendly.

---

## Phase C-1 — Shared Scaffolding

**Goal:** Add config flags, workspace template assets, and shared seeding/context assembly primitives.

| # | Task | Key Files |
|---|------|-----------|
| 1.1 | Extend `AppConfig` with `personality`, `skills`, and `memories` sections | `src/app/config.ts`, `config/config.example.yaml`, `config/config.yaml` |
| 1.2 | Add repo templates for personality and default skills | `templates/personality/*`, `templates/skills/*` |
| 1.3 | Create workspace seeding helpers for directories and template copy-if-missing behavior | `src/workspace/seeding.ts` |
| 1.4 | Update bootstrap to seed personality and skills alongside jobs | `src/app/bootstrap.ts` |
| 1.5 | Update `install.sh` to create directories and seed templates before first run | `install.sh` |
| 1.6 | Create prompt context assembler contract and types | `src/context/assembler.ts`, `src/context/types.ts` |

**Exit criteria:** A fresh install or first bootstrap produces `<workspace>/personality` and `<workspace>/skills` with default files present and user-safe copy-if-missing behavior.

---

## Phase C-2 — Personality

**Goal:** Load operator-editable personality files from the workspace and inject them into the system prompt when enabled.

| # | Task | Key Files |
|---|------|-----------|
| 2.1 | Implement personality loader for `PERSONALITY.md` and `USER.md` | `src/context/personality.ts` |
| 2.2 | Add truncation and formatting rules for injected personality content | `src/context/personality.ts` |
| 2.3 | Integrate personality block into prompt assembly | `src/context/assembler.ts`, `src/agent/prompt.ts`, `src/agent/runtime.ts` |
| 2.4 | Add tests for enabled, disabled, missing-file, and oversized-file cases | `src/context/personality.test.ts`, `src/agent/prompt.test.ts` |

**Exit criteria:** Editing workspace personality files changes the next agent turn when `personality.enabled = true`, and has no effect when disabled.

---

## Phase C-3 — Skills

**Goal:** Discover workspace skills, match them to the current request, and inject only the relevant skill instructions.

| # | Task | Key Files |
|---|------|-----------|
| 3.1 | Implement `SKILL.md` parser with YAML front matter support | `src/context/skills.ts` |
| 3.2 | Implement skill directory discovery and validation | `src/context/skills.ts` |
| 3.3 | Implement trigger scoring and top-N skill selection | `src/context/skills.ts` |
| 3.4 | Implement built-in `requires` providers: `current_jobs`, `scheduler_rules`, `job_schema`, `current_skills` | `src/context/skill-requires.ts` |
| 3.5 | Inject selected skills and required context into the prompt | `src/context/assembler.ts`, `src/agent/prompt.ts` |
| 3.6 | Seed default `job_creation` and `skill_creation` skills | `templates/skills/job_creation/SKILL.md`, `templates/skills/skill_creation/SKILL.md` |
| 3.7 | Add tests for trigger matching, malformed front matter, unknown `requires`, and prompt-size caps | `src/context/skills.test.ts` |

**Exit criteria:** Requests such as "add a recurring task" or "build a new skill" inject the corresponding workspace skill automatically, without injecting unrelated skills.

---

## Phase C-4 — Memories

**Goal:** Add durable, bounded, SQLite-backed memories with explicit agent tools.

| # | Task | Key Files |
|---|------|-----------|
| 4.1 | Add `memories` table migration | `src/storage/migrations.ts` |
| 4.2 | Create memory DAO for CRUD and ranked search | `src/storage/memories.ts` |
| 4.3 | Implement memory formatter and retrieval logic | `src/context/memories.ts` |
| 4.4 | Add memory tools: `memory_list`, `memory_create`, `memory_update`, `memory_delete` | `src/tools/memory-*.ts` |
| 4.5 | Register memory tools conditionally when `memories.enabled = true` | `src/agent/tool-registry.ts` |
| 4.6 | Inject relevant memories into the prompt before each turn | `src/context/assembler.ts`, `src/agent/runtime.ts`, `src/agent/prompt.ts` |
| 4.7 | Add tests for ranking, bounds, CRUD, and disabled mode | `src/storage/memories.test.ts`, `src/context/memories.test.ts`, `src/tools/memory-*.test.ts` |

**Exit criteria:** The agent can remember durable user facts through explicit tools and retrieve relevant memories on later turns without loading the entire memory table into the prompt.

---

## Phase C-5 — Hardening and Polish

**Goal:** Tighten behavior, improve observability, and prepare the features for later CLI support.

| # | Task | Key Files |
|---|------|-----------|
| 5.1 | Add structured logging around skill selection and memory retrieval counts | `src/context/*.ts`, `src/agent/runtime.ts` |
| 5.2 | Add redaction checks for memory writes containing obvious secret material | `src/tools/memory-create.ts`, `src/security/redact.ts` |
| 5.3 | Add prompt-budget guards across personality, skills, and memories | `src/context/assembler.ts` |
| 5.4 | Document workspace layout and config knobs in README | `README.md` |
| 5.5 | Add future CLI hooks to the backlog: config toggles, memory inspection, skill listing | `tdmClaw_CLI_TDD.md`, `tdmClaw_CLI_IP.md` |

**Exit criteria:** Runtime logs show which context features were injected, prompt size stays bounded, and the feature set is documented well enough for an operator to edit local files safely.

---

## Key Design Decisions

### Deterministic Skill Injection

Skills are selected by application logic based on trigger matching, not by asking the model to discover or request them. This keeps behavior reproducible and debuggable.

### Explicit Memory Tools

Memories are created and updated through explicit tools instead of automatic summarization passes. This reduces hidden state changes and avoids adding a second model call to every turn.

### Workspace-Owned Personality and Skills

Personality and skill content live under the workspace root, not the repo root, so the operator can customize behavior without editing source files or losing changes during upgrades.

### Copy-If-Missing Seeding

Bootstrap and install only seed default files when they do not already exist. User-edited files are never overwritten automatically.

---

## Suggested Build Order

```text
C-1 Shared scaffolding   ~0.5–1 day
C-2 Personality         ~0.5 day
C-3 Skills              ~1–1.5 days
C-4 Memories            ~1–1.5 days
C-5 Polish              ~0.5 day
```

---

## Acceptance Criteria

1. The config file can enable or disable personality, skills, and memories independently.
2. Install and bootstrap both seed default personality and skill files safely.
3. Personality files are reflected in the next agent turn when enabled.
4. Relevant skills are injected automatically based on user-request trigger matching.
5. Memories persist in SQLite and can be managed through explicit tools.
6. The prompt context remains bounded and explainable.
7. Disabling these features returns the agent to today’s baseline behavior without regressions.
