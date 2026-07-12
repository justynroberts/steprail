# newflow

Drag-and-drop orchestration, rebuilt around one idea: **you should never have to draw a wire.**

Traditional workflow tools (n8n, Node-RED, and friends) hand you a freeform canvas — and with it the spaghetti wires, the manual layout, the hunt for the failing node, the config modal that hides your flow. newflow replaces the canvas with a **rail**: a vertical, deterministically laid-out flow where structure is the editor's job, not yours.

## The interaction model

- **Insertion slots, not wires.** Pick up any tool and every legal insertion point on the rail lights up. Drop it — it's wired. Same for moving existing steps.
- **Branches as lanes.** A branch step forks the rail into parallel lanes (subway-map style) that visibly merge back. Lanes run concurrently. Add, rename, or remove lanes inline.
- **Config in place.** Click a step and it expands right there on the rail. No modal, no side panel, no losing your place.
- **Errors on the step.** A failing run puts a plain-language message on the failing card ("Service is empty — open this step and fill it in") and skips the rest of the lane visibly. The run timeline links every entry back to its step.
- **Data as fields, never JSON.** Payloads render as labeled key/value fields everywhere (data pills, step output, test output) with a `{}` raw toggle for the escape hatch.
- **Data tokens.** Every expanded step lists the fields of earlier steps as chips — click one to drop a `{{Step name.field}}` token into the focused config field. Tokens resolve during runs and tests.
- **Test a single step.** Every card has a Test step button that runs just that step against sample data from upstream — validation errors and output appear inline, no full run needed.
- **Data pills.** After a run, the payload flowing between steps shows as an inspectable pill (`4 keys · 86 b`) on the connector.
- **Three on-ramps for a new flow:** describe it in a sentence (AI compose), pick an inline template, or drag a trigger in.
- **Keyboard-first:** `/` opens the insert palette, `Cmd+Z` undoes, `Cmd+Enter` runs.

## Tool catalog

24 tools across Triggers, AI, Infra, Data, Logic, and Notify — webhook/schedule/git triggers, LLM prompts and agents, Terraform/Kubernetes/Docker, HTTP/PostgreSQL/transforms, branch/loop/wait/approval, Slack/email/PagerDuty. Execution is simulated with per-tool sample payloads; validation is real.

## Running

```bash
npm install
npm run dev        # Vite on :8451 + API on :8452
```

Open http://oracle.local:8451.

Production:

```bash
docker compose up --build -d   # serves everything on :8452
```

## Configuration

All runtime settings live in the in-app Settings drawer (theme — light by default, run speed, compose model, Anthropic API key) and persist server-side in `data/settings.json` (written owner-only). With a key set, AI compose calls the Anthropic API; without one it falls back to a local keyword planner.

## Stack

React 18 + TypeScript + Vite, a single-file Express API for persistence and the compose proxy, native HTML5 drag-and-drop (no graph library — the rail doesn't need one). Design system: `DESIGN.md` (Linear-inspired, dark-native).
