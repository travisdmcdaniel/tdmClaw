# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code. Key areas are `src/app/` for bootstrap and config, `src/telegram/` for bot handling, `src/agent/` for prompt/runtime/tool-loop logic, `src/tools/` for model-callable tools, `src/storage/` for SQLite access, `src/google/` for Google integrations, and `src/scheduler/` for scheduled jobs. Configuration templates live in `config/`, service files in `systemd/`, and design docs such as `tdmClaw_TDD.md` and `tdmClaw_IP.md` live at the repo root.

Tests are currently colocated with source files using `*.test.ts` naming, for example [src/telegram/inbound.test.ts](/home/travis/source/repos/tdmClaw/src/telegram/inbound.test.ts:1).

## Build, Test, and Development Commands
- `npm run dev`: run the app with `tsx` in watch mode from `src/index.ts`.
- `npm run build`: compile TypeScript into `dist/`.
- `npm run start`: run the compiled service from `dist/index.js`.
- `npm run test:run`: run the Vitest suite once.
- `npm run test`: start Vitest in interactive mode.
- `npm run typecheck`: run `tsc --noEmit`.
- `npm run lint`: lint `src/` with ESLint.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and 2-space indentation. Prefer named exports for modules and `camelCase` for variables/functions, `PascalCase` for types, and kebab-case filenames where already established (for example `read-file.ts`, `openai-compatible.ts`). Keep modules narrow and place helpers near the subsystem that owns them. Follow existing comment style: short, functional comments only where behavior is not obvious.

## Testing Guidelines
Use Vitest for unit tests. Add tests next to the code they cover with `*.test.ts` filenames. Cover new parsing, config, tool, and Telegram-handling branches, and run `npm run test:run && npm run typecheck` before opening a PR. Prefer focused tests over broad integration scaffolding.

## Commit & Pull Request Guidelines
Recent history uses short imperative subjects such as `Add CLI management tool and update documentation` and `Corrected errors found by typecheck`. Keep commits specific and descriptive. PRs should explain the behavioral change, mention any config or schema updates, link the relevant plan/TDD section, and include command output for verification when useful.

## Security & Configuration Tips
Do not commit secrets. Use `config/config.yaml` for local settings and `.env`/`env:` references for credentials such as Telegram bot tokens. Treat uploaded OAuth credentials, SQLite data, and anything under the workspace root as sensitive.
