<p align="center">
  <img src="docs/logo.svg" alt="steprail" width="320" />
</p>

<p align="center">
  <strong>Workflow orchestration with no canvas, no wires, and no mocks.</strong><br/>
  A rail instead of a graph. LLM-native to the core. Small enough to read in an afternoon.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-5e6ad2" />
  <img alt="docker" src="https://img.shields.io/badge/docker-multi--arch-5e6ad2" />
  <img alt="mcp" src="https://img.shields.io/badge/MCP-client%20%2B%20server-5e6ad2" />
  <img alt="otel" src="https://img.shields.io/badge/OpenTelemetry-native-5e6ad2" />
</p>

---

Every workflow tool since Node-RED hands you the same thing: a freeform canvas, a bag of nodes, and a wiring job. The canvas is where the pain lives — spaghetti edges, manual layout, hunting for the failing node, config modals that hide your flow.

**steprail deletes the canvas.** A flow is a vertical rail. Drag a tool and every legal insertion point lights up; drop it and it's wired — miswiring is impossible by construction. Branches fork into parallel lanes that visibly merge back. Config expands in place. Errors land on the step that caused them, in plain language. A teenager can build a real automation in two minutes; the same tool runs Terraform with human approval gates.

<p align="center"><img src="docs/screenshots/newflow-real-run.png" alt="the rail editor" width="820"/></p>

## Run it (one command)

From a clone of the repo:

```bash
make up
```

That builds the image, starts steprail + a demo Postgres, seeds the demo data, waits for health, and prints the URL. Open **`http://localhost:8452`**. `make down` stops it; `make help` lists every target.

| Goal | Command |
|---|---|
| Just run it (Docker) | `make up` |
| Hot-reload dev (Vite :8451 + API :8452) | `make dev` |
| Run the tests | `make test` |
| Follow logs · wipe everything | `make logs` · `make clean` |
| No-clone quick try | `curl -fsSL https://raw.githubusercontent.com/justynroberts/steprail/main/docker-compose.yml -o docker-compose.yml && docker compose up -d` |

No Make? `docker compose up --build -d` does the same, then `make seed` loads the demo DB. **New here? The [User Guide](docs/USER-GUIDE.md) goes from zero to a running flow in five minutes.**

## What makes it different

**The rail.** Insertion slots instead of wires. Deterministic auto-layout. Branch lanes with real routing (only the matching lane runs; `else` catches the rest). In-place config. Payloads shown as labeled fields everywhere — raw JSON is a toggle, never the default.

**Real execution, honestly.** Runs execute server-side on a durable event queue: HTTP calls go out, transforms run in a sandbox, AI steps call the Anthropic API, infra steps shell out to real `terraform`/`kubectl`/`ssh`/`aws`/`docker` (bundled in the image), Slack/email/PagerDuty/Postgres deliver via named connections. An unconnected step fails with *"Slack is not connected — add a connection in Config"* — never a fake success. Waits park in the queue and survive restarts. Approvals hold a run for days and resume on click. Failures retry with backoff, visibly.

**LLM-native, both directions.** Every flow is one portable JSON object — no internal ids — that an LLM can write (a self-contained authoring prompt ships in the app) and the editor imports tolerantly. And steprail *is an MCP server*: any flow starting with an MCP trigger becomes a typed tool that Claude Code/Desktop can call at `/mcp`. Point the built-in **AI agent** step (a real tool-use loop) at any MCP server — including steprail's own — and flows orchestrate flows.

**Observable like production software.** Every run is an OpenTelemetry trace; every step a span with attempts, status, and events for retries and holds. Outgoing HTTP carries W3C `traceparent`. A built-in waterfall viewer answers "where did the time go"; `?format=otlp` and an optional collector endpoint feed Jaeger/Tempo/Grafana.

<p align="center"><img src="docs/screenshots/newflow-trace-viewer.png" alt="trace viewer" width="820"/></p>

**Low-code all the way down.** Hosted forms built field-by-field (live URL, submissions start runs). Schedules picked as "Weekdays at 8am", cron compiled underneath. JSON config values edited as key/value rows with a raw toggle. Data tokens — `{{Step.field}}`, `{{var.*}}`, `{{config.*}}`, `{{system.*}}` — inserted by clicking chips, resolved for real at run time.

## Tool catalog (31)

| | |
|---|---|
| **Triggers** | Webhook · Form · MCP tool call · Schedule · Git push · File watch |
| **AI** | LLM prompt · AI agent (MCP tool-use loop) · MCP tool · Extract (structured output) · Classify · Summarize |
| **Infra** | Terraform (inline HCL or dir) · Kubernetes · Docker build · SSH · Ansible (inline or git) · Git (clone/commit/push/merge/tag) · Cloud function |
| **Data** | HTTP request · PostgreSQL · Transform (JS) · Filter · Memory (cross-run state) |
| **Logic** | Branch · Loop (per-item) · Until (repeat-until) · Run flow (subflows + passed variables) · Wait · Approval |
| **Notify** | Slack · Email · PagerDuty |

Thirty tagged blueprints — each card previews its actual flow as an icon chain — cover deploys, triage, uptime, forms-to-CRM, agents, Ansible fleet ops, and data sync. **Forms** go further than a static page: a choice field can pull its dropdown options live from any JSON API (map `path → label · value`), so an assignee or region list is always current.

<p align="center"><img src="docs/screenshots/newflow-blueprint-cards.png" alt="blueprints" width="820"/></p>

## Architecture

```
browser (React + TS, the rail)          server (single Node process)
  flows/blueprints/config pages   ──►     Express API + static
  editor: palette · rail · runs   ──►     event queue (JSON file, worker loop)
                                          real executors (fetch/vm/CLIs/MCP/AI)
  /hooks/*  /forms/*  /mcp        ──►     triggers: armed schedules, live endpoints
                                          OTel spans → viewer / OTLP export
```

One process, one data directory, one table-shaped queue with `state` and `not_before` — that's how waits, approvals, retries, loops, and crash recovery all work. Swapping the queue file for SQLite/Postgres/Redis changes four functions. The flow model is a **tree, not a graph**: order in the array is the wiring; the whole editor and engine walk the same tree. Design docs: [`docs/ARCH-QUEUE.md`](docs/ARCH-QUEUE.md) · [`docs/ARCH-AI-OTEL.md`](docs/ARCH-AI-OTEL.md) · [`docs/UX-REVIEW.md`](docs/UX-REVIEW.md).

## Security posture

Secrets (connections, API keys) are write-only: stored owner-only on disk, never returned to the browser, redacted from run errors. Opt-in access token locks the whole API. CLI executors reject flag injection. The JS sandbox and open HTTP egress are deliberate — the flow author is the operator; set the token before exposing beyond your network.

## Status

Early and honest: personal/homelab-grade durability (file-backed queue, single process), 30-plus connectors plus anything MCP speaks, and a committed test suite (`make test` — engine unit tests plus API integration tests that boot a real server). The bones — rail UX, real queue, MCP both ways, OTel — are the point.

MIT © fintonlabs.com
