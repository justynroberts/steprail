# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

steprail — a drag/drop orchestration editor ("n8n for 2026") built around a **rail** instead of a freeform canvas: vertical auto-layout, insertion slots instead of wires, branches as parallel lanes, in-place config, plain-language run errors. UX rationale and interaction model are in README.md; visual rules are in DESIGN.md (Linear system — binding for all UI work).

## Commands

```bash
npm run dev          # Vite client :8451 + Express API :8452 (concurrently)
npm run build        # tsc --noEmit (strict) then vite build — must pass clean
npm start            # production: Express serves dist/ + API on :8452
docker compose up --build -d
```

URLs: http://oracle.local:8451 (dev), health at `/api/health`. `npm test` runs the committed suite (`tests/`): engine unit tests plus API integration tests that boot a real server on a temp `STEPRAIL_DATA_DIR` — run it after engine/server changes. UI verification stays browser-driven (Playwright/Puppeteer against oracle.local:8451).

## Architecture

The flow is a **tree, not a graph**: `Flow.steps: Step[]`, and a branching step carries `branches: Branch[]`, each with its own nested `steps`. Rendering (`Rail.tsx`) and execution (`engine.ts`) both walk this tree recursively. There are no edges anywhere — order in the array IS the wiring. Positions in the tree are addressed by `SlotPath` (`{hops: [{stepId, branchId}...], index}`), which is how drops, inserts, and the command palette target a location.

- `src/state.tsx` — single reducer; every mutation deep-clones `flow.steps` (flows are small; cloning makes the undo history free). Tree helpers (`listAt`, `findStep`, `removeStep`, subtree guard for moves) live here.
- `src/tools.ts` — the tool catalog. Adding a tool = one entry (fields drive the config form, `sample()` drives data pills, `branching: true` makes it fork lanes). No other file needs touching.
- `src/engine.ts` — client glue over `shared/enginecore.mjs`: re-exports the token machinery, `sampleUpstream()` (shape suggestions for token chips — NOT run results), `upstreamOutputsFromRun()` (real data for step tests), and `localPlan()` keyword fallback for AI compose. Actual runs happen server-side; the client starts them via `POST /api/runs` and polls.
- `src/components/FieldView.tsx` — all payload display goes through this (flattened key/value rows + raw JSON toggle). Never render raw JSON directly in the UI; `flattenData()` also feeds the token chips in StepCard.
- `src/flowjson.ts` — the portable flow format (one JSON object per flow, no internal ids): `serializeFlow`/`hydrateFlow` (tolerant — warnings, not failures), `llmPrompt()` (self-contained authoring prompt). Everything that moves flows around uses this: import/export dialog, AI compose, blueprints. Carries `docs` (the flow's Markdown write-up) alongside name/steps/vars/tags.
- `src/diagram.ts` + `src/markdown.ts` — flow documentation. `flowToMermaid()` walks the same tree into a Mermaid flowchart (branches → labeled lanes merging into a `done` terminal); `describeFlow()` is the deterministic starter write-up; `flowDocMarkdown()` = prose + embedded ```mermaid fence for copy/download. `renderMarkdown()` is a small escape-first Markdown→HTML renderer (safe subset only). Surfaced by `DocsDialog.tsx` (Mermaid is lazy-imported so it stays out of the main bundle). StepHan authors `flow.docs` at compose time (prompt rule in `promptcore.mjs`).
- `src/blueprints.ts` — built-in blueprints stored as portable JSON (dogfoods the format); custom ones persist via `/api/blueprints`.
- `src/ui.ts` — `UICtx` carries cross-cutting state: current drag payload (HTML5 dnd `dataTransfer` isn't readable during dragover, so drag state lives in React context), live `RunState`, `openPalette(at)`, and `insertTarget` (the last-focused config field — where clicked variable/data tokens land).
- `shared/*.mjs` — single source for the tool catalog (`toolcore`), token machinery (`enginecore`), schedules, and hosted forms (`formcore`: field defs + server-rendered form/success HTML at `/forms/*`), used verbatim by both the browser and the server; each has a hand-written `.d.mts` so strict TS sees real types. Client `src/tools.ts` only adds lucide icons. `sample()` in toolcore is NOT what runs return — it only suggests output shapes for token chips.
- `server/queue.mjs` + `server/executors.mjs` — real execution: a file-backed event queue (state + not_before columns; approve() flips waiting→queued; worker loop every 250ms; schedule triggers armed via nextOccurrence; webhook runs enter via `/hooks/*`). Executors do real work (fetch, node:vm sandbox, Anthropic, spawn'd CLIs, nodemailer/pg) and throw plain-language errors when a connection is missing — never fake a success. Loop/Until/Subflow are queue-level (event context, never blocking the worker); every step emits an OTel span (run.spans, `traceAsOtlp()`, optional collector export). See docs/ARCH-QUEUE.md + docs/ARCH-AI-OTEL.md.
- `server/mcp.mjs` — minimal MCP client (stdio + HTTP JSON-RPC) used by the `ai.mcptool` step and the `ai.agent` tool-use loop; `POST /mcp` in index.mjs is the inverse: flows with a `trigger.mcp` first step are served as MCP tools.
- `server/index.mjs` — flows/settings/blueprints persistence to `data/*.json`, `/api/compose` proxy, `/api/runs` + `/api/test-step` + approval endpoints. All credential settings (Anthropic, Slack webhook, PagerDuty, SMTP, Postgres) are write-only: encrypted at rest via `server/secrets.mjs` (AES-256-GCM; key from `STEPRAIL_ENCRYPTION_KEY` or auto-generated `data/.encryption-key`), stored 0o600 + atomic rename, decrypted only at the readSettings boundary, surfaced to the browser only as `has*` flags.
- **Projects are the tenant boundary** (`projectId` on flows, runs, connections; `data/projects.json`, "default" always exists, deletion moves contents there). Secrets and `{{config.*}}` config are STRICTLY per-project — no shared scope; pre-projects data migrates to Default at boot (index.mjs `migrateSettingsToProjects`). Resolution is enforced server-side at execution time: `scopeSettings()` (connections) and `scopedGlobals()` (`settings.projectGlobals[pid]`) in queue.mjs; subflows only resolve same-project flows. The browser's active project lives in localStorage (`src/projects.ts`); `makeFlow` stamps it on every creation path. Future RBAC binds roles to these ids — see docs/PRD.md § Projects.

## Conventions that matter here

- Config belongs in the Settings drawer (persisted via `/api/settings`), not in env vars or files — `PORT` is the only bootstrap exception.
- Colors/typography only via the CSS custom properties in `src/styles/tokens.css` (dark default + `[data-theme='light']`); never hardcode hex in components. Inter with `font-feature-settings: 'cv01','ss03'`; max font weight 590.
- Icons: lucide-react only, no emojis. MIT license header (`// MIT License - Copyright (c) fintonlabs.com`) on all source files.
- Ports 8451/8452 are this project's; never kill other processes' ports.
- `cli/` (Go, stdlib-only) mirrors the API — when an endpoint the CLI touches changes meaningfully (flows list/import, runs start/status), update `cli/main.go` in the same change and rebuild (`cd cli && go build -o steprail .`).
