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
  <img alt="secrets" src="https://img.shields.io/badge/secrets-AES--256--GCM-5e6ad2" />
  <img alt="tools" src="https://img.shields.io/badge/tools-34-5e6ad2" />
</p>

---

Every workflow tool since Node-RED hands you the same thing: a freeform canvas, a bag of nodes, and a wiring job. The canvas is where the pain lives — spaghetti edges, manual layout, hunting for the failing node, config modals that hide your flow.

**steprail deletes the canvas.** A flow is a vertical rail. Drag a tool and every legal insertion point lights up; drop it and it's wired — miswiring is impossible by construction. Branches fork into parallel lanes that visibly merge back. Config expands in place. Errors land on the step that caused them, in plain language. A teenager can build a real automation in two minutes; the same tool runs Terraform behind a human approval gate.

<p align="center"><img src="docs/screenshots/newflow-real-run.png" alt="the rail editor" width="820"/></p>

## Requirements

To **run** it, you need exactly one thing:

- **Docker** (with Compose) — macOS or Linux; Windows via WSL2. Ports **8451** and **8452** free.

That's the whole list. No clone, no config files, no API keys to boot — the demo data lets you click around immediately. Optional, and all set later in the UI (encrypted at rest):

- An **Anthropic API key** for StepHan (AI flow authoring/editing) — without it StepHan falls back to a keyword sketch; everything else works.
- **Connections** for whatever your flows actually touch (Slack, Postgres, SMTP, PagerDuty, SSH…), added under **Secrets**.
- The infra CLIs (`terraform`, `kubectl`, `ssh`, `ansible`, `git`, `aws`, `docker`) are **already bundled in the image** — nothing to install.

Only **developing** steprail (not just running it) needs **Node.js 22 + npm** for `make dev`; the Docker image ships its own runtime.

## Run it (one command)

Nothing to clone, no config to edit — just Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/justynroberts/steprail/main/install.sh | sh
```

Fetches the project, starts steprail + a demo Postgres (pulls the prebuilt multi-arch image when available, otherwise builds), seeds the demo data, waits for health, and opens **`http://localhost:8452`**. Works on macOS and Linux (Windows via WSL). Everything after startup is set in the UI — there are no config files to hand-edit.

Prefer to drive it yourself? From a clone:

| Goal | Command |
|---|---|
| Run it (Docker) | `make up` |
| Hot-reload dev (Vite :8451 + API :8452) | `make dev` |
| Run the tests | `make test` (engine + API) · `make test-e2e` (browser) |
| Logs · stop · wipe | `make logs` · `make down` · `make clean` |

Want it hosted with HTTPS? steprail is **Railway-native** (binds `$PORT`, ships a `railway.json` with the healthcheck) — deploy from the repo, add a volume at `/data`, done. See [Deploy → Railway](docs/DEPLOY.md#4-railway-managed-https).

**New here? The [User Guide](docs/USER-GUIDE.md) goes from zero to a running flow in five minutes. Self-hosting for a team? The [Deploy Guide](docs/DEPLOY.md) covers persistence, TLS, the production checklist, and publishing your own image.**

## What makes it different

**The rail — miswiring is impossible.** Insertion slots instead of wires. Deterministic auto-layout, so a flow always looks the same. Branch lanes with real routing (only the matching lane runs; an `else` lane catches the rest, or leave the key blank to fan out in parallel and merge). Config expands in place. Every payload renders as labeled key/value fields — raw JSON is a toggle, never the wall of text you start with.

**Real execution, honestly.** Runs execute server-side on a durable, SQLite-backed event queue. HTTP calls actually go out; transforms run in a `node:vm` sandbox; AI steps call Anthropic; infra steps shell out to real `terraform` / `kubectl` / `ssh` / `ansible` / `git` / `aws` / `docker` (all bundled in the image). An unconnected step fails with *"Slack is not connected — add a connection in Secrets"* — **never a fake success.** Waits park in the queue and survive restarts. Approvals hold a run for days and resume on a click. Failures retry with backoff, visibly.

**LLM-native, both directions.** Every flow is one portable JSON object with no internal ids — an LLM can author it (a self-contained prompt ships in the app) and the editor imports it tolerantly. **StepHan**, the built-in assistant, turns a sentence into a complete, configured flow — *and writes its documentation as it goes*. It also **modifies the open flow in place** ("add a Slack alert if it fails", "put a human approval before the deploy"), keeping everything you didn't ask to change, with undo one keystroke away. Any flow saves as a reusable **blueprint** in a click. And steprail *is an MCP server*: any flow that starts with an MCP trigger becomes a typed tool Claude Code/Desktop can call at `/mcp`. Point the **AI agent** step (a real tool-use loop) at any MCP server — including steprail's own — and flows orchestrate flows.

**Documented by construction.** Every flow carries a Markdown write-up and an auto-generated **Mermaid diagram** of the rail (branch lanes and all). Open the Docs panel to read it, edit the prose, or copy/download the whole thing as Markdown — the diagram travels as a ```mermaid block that renders on GitHub, Scrivenry, Notion, and anywhere else. StepHan fills the write-up in when it drafts a flow; hand-built flows get a generated outline you can refine.

**Observable like production software.** Every run is an OpenTelemetry trace; every step a span with attempts, status, and events for retries and holds. Outgoing HTTP carries W3C `traceparent`. A built-in waterfall viewer answers "where did the time go", and `?format=otlp` (plus an optional collector endpoint) feeds Jaeger / Tempo / Grafana. The **Reports** page keeps a persistent per-project daily rollup (30-day chart + all-time totals) that outlives the capped run history — analytics don't collapse to "just today".

<p align="center"><img src="docs/screenshots/newflow-trace-viewer.png" alt="trace viewer" width="820"/></p>

**Low-code all the way down.** Hosted forms built field-by-field, served at a live URL, each submission starting a run — and a choice field can populate its dropdown **live from any JSON API**. Schedules picked as "Weekdays at 8am", cron compiled underneath. Config values edited as key/value rows. Data tokens — `{{Step.field}}`, `{{var.*}}`, `{{config.*}}`, `{{system.*}}`, wildcards — inserted by clicking chips and resolved for real at run time.

## Tool catalog (34)

| | |
|---|---|
| **Triggers** (6) | Webhook · Form · MCP tool call · Schedule · Git push · File watch |
| **AI** (6) | LLM prompt · AI agent (MCP tool-use loop) · MCP tool · Extract (structured output) · Classify · Summarize |
| **Infra** (7) | Terraform (inline HCL or dir) · Kubernetes · Docker build · SSH · **Ansible** (inline / git playbook, inline / git inventory) · **Git** (clone · commit · push · pull · merge · tag) · Cloud function |
| **Data** (5) | HTTP request · PostgreSQL · Transform (JS) · Filter · Memory (cross-run state) |
| **Logic** (7) | Branch · Loop (per-item) · Until (repeat-until) · Run flow (subflows + passed vars) · Wait · Approval · **Exit** (stop the run early) |
| **Notify** (3) | Slack · Email · PagerDuty |

**32 tagged blueprints** — each card previews its real flow as an icon chain — cover deploys, incident triage, uptime, forms-to-CRM, AI agents, Ansible fleet ops, and data sync. Adding a tool is one entry in a catalog file; adding a blueprint is one JSON object.

<p align="center"><img src="docs/screenshots/newflow-blueprint-cards.png" alt="blueprints" width="820"/></p>

## Architecture

```
browser (React + TS, the rail)          server (single Node process)
  flows/blueprints/config pages   ──►     Express API + static
  editor: palette · rail · runs   ──►     event queue (SQLite WAL, worker loop)
                                          real executors (fetch/vm/CLIs/MCP/AI)
  /hooks/*  /forms/*  /mcp        ──►     triggers: armed schedules, live endpoints
                                          OTel spans → viewer / OTLP export
```

One process, one data directory, one table-shaped queue with `state` and `not_before` columns — that's how waits, approvals, retries, loops, and crash recovery all work from the same mechanism. SQLite is the default store; point `STEPRAIL_DB_URL` at Postgres for an external, backup-friendly database. Multi-instance HA (a normalised event table with `SELECT … FOR UPDATE SKIP LOCKED`) is a planned follow-on. The flow model is a **tree, not a graph**: order in the array *is* the wiring, and the whole editor and engine walk the same tree. **Projects** are the tenant boundary — flows, runs, connections, and `{{config.*}}` values are strictly per-project.

Design docs: [`docs/ARCH-QUEUE.md`](docs/ARCH-QUEUE.md) · [`docs/ARCH-AI-OTEL.md`](docs/ARCH-AI-OTEL.md) · [`docs/UX-REVIEW.md`](docs/UX-REVIEW.md) · [`docs/PRD.md`](docs/PRD.md).

## Security posture

steprail is built to be exposed carefully, and the credential path is defence-in-depth:

- **Secrets are write-only and encrypted at rest.** Connections and API keys are sealed with **AES-256-GCM** (per-secret random IV); the 32-byte key comes from `STEPRAIL_ENCRYPTION_KEY` or an auto-generated `data/.encryption-key` written `0600`. Decryption happens only at the execution boundary — the browser sees `has*` flags, never a value, and secrets are redacted from run errors.
- **Strictly per-project isolation.** Secrets and config resolve per project at execution time; a flow can never read another project's connections, and subflows only call same-project flows.
- **Opt-in access token locks the whole API** (constant-time comparison), leaving `/hooks/*` open for external senders to gate by per-path secrecy.
- **CLI executors reject flag smuggling.** Step values that look like `-flags` are refused, so a `{{token}}` carrying webhook data can't inject options. `kubectl` command mode additionally refuses any flag that would redirect the cluster or credentials; the GitHub token for `git` never touches argv (it rides in a `0600` `GIT_CONFIG_GLOBAL`).
- **SSRF-hardened outbound lookups.** The one place a request URL comes from config — a form's live-dropdown API — blocks loopback/private/link-local/CGNAT/cloud-metadata targets, **pins the connection to the validated IP** (no DNS-rebinding window), refuses redirects, caps the response, and only fetches URLs already saved in a flow.
- **SSH keys and kubeconfigs** are written to `0600` temp files and cleaned up; nothing rides in the process list.
- **Rate-limited and header-hardened.** Per-IP limits blunt floods on the public surfaces (webhooks, forms, compose, MCP); every response carries `nosniff` / `X-Frame-Options` / `Referrer-Policy`, and hosted form pages ship a strict `Content-Security-Policy` (`script-src 'none'`). The limiter keys on the socket IP by default (unspoofable) — set `STEPRAIL_TRUST_PROXY` only when you're behind a real reverse proxy.

The `node:vm` sandbox and open HTTP egress from `data.http` are deliberate — the flow author is the operator. Set the access token before exposing steprail beyond your network, and terminate TLS at a reverse proxy for anything past your LAN.

## Configuration (environment)

Everything else is set in the UI; these are the only environment knobs, all optional:

| Variable | Purpose |
|---|---|
| `PORT` | API/web port (default `8452`). |
| `STEPRAIL_ENCRYPTION_KEY` | Secret-encryption key. **Set this in production** (from a secret store) — otherwise one is auto-generated into `data/.encryption-key` and a warning is logged. |
| `STEPRAIL_ENCRYPTION_KEY_PREVIOUS` | The old key during a rotation: reads fall back to it and every secret is re-encrypted to the new key on boot. Remove once rotation completes. |
| `STEPRAIL_TRUST_PROXY` | Set only behind a real reverse proxy, so the rate limiter reads `X-Forwarded-For`. |
| `STEPRAIL_DATA_DIR` | Where the SQLite DB + encryption key live (default `./data`). |
| `STEPRAIL_DB_URL` | Use Postgres instead of the default SQLite (e.g. `postgres://user:pass@host:5432/db`). External, backup-friendly; still single-instance. |
| `STEPRAIL_LOGIN_USER` / `STEPRAIL_LOGIN_PASSWORD` | Front-door login (defaults `steprail` / `automation`; production refuses to start until you set the password (or STEPRAIL_LOGIN_DISABLED=1); the built-in default is public). `STEPRAIL_LOGIN_DISABLED=1` turns it off. |
| `NODE_ENV` | `production` enables prod-only warnings (e.g. missing encryption key). |

Persistence, backups, TLS, and the production checklist are in the **[Deploy Guide](docs/DEPLOY.md)**.

## Status

Early and honest: single-process durability on a crash-safe SQLite (WAL) store, **34 tools** plus anything MCP speaks, and a three-layer test suite — unit (reducer, flow model, engine), server integration (`make test`, boots a real server on a temp data dir), and browser E2E (`make test-e2e`, drives the real built app in Chromium: run a flow, read the OTel trace, prove an unconnected step fails in plain language). The bones — rail UX, a real queue, MCP in both directions, OTel tracing, and a hardened credential path — are the point. The road from here to dependable production is mapped in [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md).

MIT © fintonlabs.com
