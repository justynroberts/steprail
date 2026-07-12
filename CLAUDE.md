# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

newflow — a drag/drop orchestration editor ("n8n for 2026") built around a **rail** instead of a freeform canvas: vertical auto-layout, insertion slots instead of wires, branches as parallel lanes, in-place config, plain-language run errors. UX rationale and interaction model are in README.md; visual rules are in DESIGN.md (Linear system — binding for all UI work).

## Commands

```bash
npm run dev          # Vite client :8451 + Express API :8452 (concurrently)
npm run build        # tsc --noEmit (strict) then vite build — must pass clean
npm start            # production: Express serves dist/ + API on :8452
docker compose up --build -d
```

URLs: http://oracle.local:8451 (dev), health at `/api/health`. No test suite yet — verification is browser-driven (Playwright/Puppeteer against oracle.local:8451).

## Architecture

The flow is a **tree, not a graph**: `Flow.steps: Step[]`, and a branching step carries `branches: Branch[]`, each with its own nested `steps`. Rendering (`Rail.tsx`) and execution (`engine.ts`) both walk this tree recursively. There are no edges anywhere — order in the array IS the wiring. Positions in the tree are addressed by `SlotPath` (`{hops: [{stepId, branchId}...], index}`), which is how drops, inserts, and the command palette target a location.

- `src/state.tsx` — single reducer; every mutation deep-clones `flow.steps` (flows are small; cloning makes the undo history free). Tree helpers (`listAt`, `findStep`, `removeStep`, subtree guard for moves) live here.
- `src/tools.ts` — the tool catalog. Adding a tool = one entry (fields drive the config form, `sample()` drives data pills, `branching: true` makes it fork lanes). No other file needs touching.
- `src/engine.ts` — simulated runner (validates required fields → plain-language error on the step, skips the rest of the lane, lanes run via Promise.all) + `localPlan()` keyword fallback for AI compose. Also the low-code layer: `interpolateWith` resolves `{{Step name.path}}` tokens against upstream outputs, `testStep()` runs one step in isolation against `sampleUpstream()` data.
- `src/components/FieldView.tsx` — all payload display goes through this (flattened key/value rows + raw JSON toggle). Never render raw JSON directly in the UI; `flattenData()` also feeds the token chips in StepCard.
- `src/flowjson.ts` — the portable flow format (one JSON object per flow, no internal ids): `serializeFlow`/`hydrateFlow` (tolerant — warnings, not failures), `llmPrompt()` (self-contained authoring prompt). Everything that moves flows around uses this: import/export dialog, AI compose, blueprints.
- `src/blueprints.ts` — built-in blueprints stored as portable JSON (dogfoods the format); custom ones persist via `/api/blueprints`.
- `src/ui.ts` — `UICtx` carries cross-cutting state: current drag payload (HTML5 dnd `dataTransfer` isn't readable during dragover, so drag state lives in React context), live `RunState`, `openPalette(at)`, and `insertTarget` (the last-focused config field — where clicked variable/data tokens land).
- `server/index.mjs` — whole backend: flows/settings persistence to `data/*.json` and the `/api/compose` Anthropic proxy. Settings writes are owner-only (0o600 fd mode + atomic rename) because they can hold the API key; the key is never returned to the browser (only `hasAnthropicKey`).

## Conventions that matter here

- Config belongs in the Settings drawer (persisted via `/api/settings`), not in env vars or files — `PORT` is the only bootstrap exception.
- Colors/typography only via the CSS custom properties in `src/styles/tokens.css` (dark default + `[data-theme='light']`); never hardcode hex in components. Inter with `font-feature-settings: 'cv01','ss03'`; max font weight 590.
- Icons: lucide-react only, no emojis. MIT license header (`// MIT License - Copyright (c) fintonlabs.com`) on all source files.
- Ports 8451/8452 are this project's; never kill other processes' ports.
