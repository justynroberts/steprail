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

---

## Projects (v0.2) — tenancy segmentation

### Problem

Everything in steprail lives in one flat namespace: every flow, run, and secret is visible everywhere. Once more than one team, customer, or environment uses an install, that's untenable — a person configuring the "marketing" flows should not see (or accidentally reference) the production database credentials. Full RBAC is the eventual answer; the first step is a **hard segmentation primitive** those roles can later bind to.

### Model

A **project** is the tenant boundary. Every tenanted record carries a `projectId`, and that field is the single key future RBAC will authorize against.

| Entity | Tenancy rule |
|---|---|
| Flow | Belongs to exactly one project (`flow.projectId`). |
| Run / execution | Inherits the flow's project at `createRun` time (`run.projectId`); reports and consumption stats are computed per project. |
| Secret / connection | Owned by one project, **or shared** (no `projectId`) — visible to all projects. |
| Config (`{{config.*}}` values) | Per project with a shared base layer: a run sees shared values with its project's values on top (`settings.projectGlobals[projectId]` over `settings.globals`). |
| Blueprint | Global (templates carry no credentials); instantiating one lands the flow in the active project. |
| Setup (branding, theme, operator token, OTLP) | Install-wide, not tenanted. |

Rules:

1. A built-in **Default** project (`id: "default"`) always exists and cannot be deleted or renamed away — it's the migration target and the fallback for any record missing a `projectId` (all pre-v0.2 data lands there automatically on read; no migration script).
2. **Deleting a project moves its flows and secrets to Default** — deletion never destroys user work. Its config values merge into Default's (Default's own keys win on conflict).
3. **Secret resolution is scoped per run.** When a step resolves a connection (named or "first of type" default), the visible pool is *this project's connections first, then shared ones* — a flow can never reach another project's secret. Enforced server-side at execution time (queue worker and test-step), not just hidden in the UI.
4. The **portable flow JSON stays project-free** — exports carry no `projectId`; imports land in the active project. Projects are an install concept, not a document concept.
5. Server-side trigger entry points (webhooks, forms, schedules, MCP) fire regardless of the UI's active project — segmentation is about data visibility, not execution isolation.

### UX

- **Project switcher in the nav rail** (top, under the logo): shows the active project; the popover lists projects, creates new ones inline, and offers rename/delete. Active project persists per browser (`localStorage`).
- Flows, Reports, Secrets, and Config pages show only the active project's records (Secrets additionally shows shared ones, badged `shared`; Config stacks the project editor above the shared one).
- New secrets choose a scope: *this project* (default) or *all projects*.

### Future: RBAC

Roles will be grants of the form *(principal, role, projectId)* — viewer/editor/admin per project. Because every flow, run, and secret already carries `projectId`, RBAC becomes an authorization check in front of existing filters, not a data-model change. Out of scope for v0.2: users, auth providers, per-project API tokens.
