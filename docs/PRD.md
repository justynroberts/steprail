# PRD: newflow — Rail-Based Orchestration Editor

> Note: authored for Scrivenry (`PRD: newflow — Rail-Based Orchestration Editor`); the
> Scrivenry service at oracle.local:9009 was unreachable at ship time. Push this page
> there when it's back.

**Status**: v0.1 shipped (2026-07-12) · **Location**: ~/work/newflow · **URL**: http://oracle.local:8451 (dev), Docker on :8452

## Problem

n8n-class tools inherit a freeform node canvas, and the canvas is the root of their UX debt: spaghetti wires, manual layout, hunting the canvas for failing nodes, config modals that hide the flow, template galleries in separate tabs. (Sources: n8n community reports, softailed/cybernews 2026 reviews, workflowbuilder.io comparisons.)

## Bet

Kill the canvas. The editor is a **rail**: a vertical, deterministically auto-laid-out flow. Structure is the editor's job, not the user's.

## Interaction model (the product)

1. **Insertion slots, not wires** — dragging any tool lights up every legal insertion point; dropping auto-wires. Moving steps works the same way. Wiring errors are impossible by construction.
2. **Branches as lanes** — a branch step forks the rail into parallel, labeled lanes (subway-map fork/merge curves). Lanes execute concurrently.
3. **Config in place** — step cards expand inline; no modal, no context loss.
4. **Errors on the step** — plain-language validation errors render on the failing card; the rest of the lane visibly skips. Run timeline entries link back to their steps.
5. **Data pills** — post-run, inter-step payloads show as inspectable pills on the connector.
6. **Three on-ramps** — AI compose (sentence → scaffolded flow; Anthropic API when key set, local keyword planner otherwise), inline templates, or drag a trigger.
7. **Keyboard-first** — `/` insert palette with fuzzy search, Cmd+Z undo, Cmd+Enter run.

## Scope shipped in v0.1

- 24-tool catalog: Triggers / AI / Infra / Data / Logic / Notify
- Simulated execution engine with per-tool sample payloads and real required-field validation
- Flows + settings persisted server-side (owner-only file modes for credential-bearing settings)
- Settings UI: theme (dark default), run speed, compose model, Anthropic key
- Design system: Linear (DESIGN.md), Inter var with cv01/ss03, dark-native + light theme
- Docker packaging with healthcheck and volume persistence

## Non-goals (v0.1)

Real connector execution, auth to third-party services, collaboration/multiplayer, versioned run history.

## Architecture notes

React 18 + TS + Vite (:8451) proxying a single-file Express API (:8452). Flow model is a tree (branches contain nested step lists) — no edge list exists anywhere; array order is the wiring. Native HTML5 drag/drop; no graph library.
