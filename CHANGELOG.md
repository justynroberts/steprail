# Changelog

All notable changes to steprail. Dates are ISO; versions follow SemVer while pre-1.0.

**Versioning:** the version in `package.json` is bumped on every substantive change and surfaced at `/api/health` (`version`) and in the app, so anyone testing a build can tell exactly which one they're on. Tag (`git tag vX.Y.Z && git push --tags`) when cutting a release.

## v0.4.7 — 2026-07-22

- **Terraform version is self-resolving** — the Dockerfile now fetches the current terraform version from HashiCorp's checkpoint API at build time, falling back to the pin (`1.15.8`), so a stale or mistyped version pin can never fail the build. (Combined with the `uname -m` arch fix, the terraform install is robust on any builder.)

## v0.4.6 — 2026-07-22

- **Fix Docker build on amd64 builders (Railway/Fly)** — the terraform arch came from an `ARG TARGETARCH` that silently defaulted to `arm64`, so on an amd64 builder that doesn't pass it, an arm64 terraform binary was fetched and `terraform -version` failed the build. Now detected from `uname -m` at build time (verified: amd64 → `Terraform v1.15.8`), robust on any builder.

## v0.4.5 — 2026-07-22

- **Docker healthcheck respects `$PORT`** — probes `${PORT:-8452}` instead of a hardcoded 8452, so the in-container check is correct on Railway/Fly/etc. where the platform injects the port (verified: the image binds an injected `PORT` cleanly).

## v0.4.4 — 2026-07-22

- **Railway deploy** — a committed `railway.json` (Dockerfile build + `/api/health` healthcheck + restart policy) makes steprail near one-click on Railway; it already binds Railway's injected `$PORT`. The Deploy Guide gains a step-by-step Railway section (volume at `/data`, encryption key, trust-proxy), and the README links it.

## v0.4.3 — 2026-07-21

- **SSH “Allow non-zero exit” option** — for scripts (like a health-check) whose exit code is a *status count*, not a failure. When on, the step succeeds across every target and captures each host’s exit code + output, so a group run reports per-host results instead of “all N hosts failed”.

## v0.4.2 — 2026-07-21

- **Run from the Flows list now opens the flow** and starts it, so you watch the steps run live on the rail instead of guessing from a toast.
- **Infrastructure → Targets** — renamed, tighter/smaller layout, and every host row is **inline-editable** (address · tags · user · port). Added **CSV import** (columns: address, tags, user, port).
- **Dark-theme contrast fix** — a brandable accent is now contrast-adjusted: the raw colour still fills buttons (paired with white text), but the accent used for text/borders/tints is lifted so a near-black brand can't vanish on a dark background (and text selection stays legible).
- **Clearer SSH failures** — a non-zero exit is no longer reported as "sshpass exited with code 1". SSH now distinguishes a real connect/auth failure (exit 255) from "the command ran and returned code N" (its own exit code), and shows the command output — so an audit script that exits with its failure count reads correctly instead of looking like an SSH error.

## v0.4.1 — 2026-07-21

- **Run a flow from the Flows list** — a Run button on each row fires the flow and toasts the result, no need to open the editor (form-triggered flows open so you can fill them in).
- Infrastructure page polish: tag chips are legible in dark theme regardless of a brandable accent (no more black-on-black), and the content is width-constrained on wide screens.

## v0.4.0 — 2026-07-21

- **Infrastructure** — a new nav section to register hosts and tag them into groups (`linux`, `east`, `prod`…). A tag *is* a group; hosts are strictly per-project.
- **Use groups as targets** — SSH steps gain a **Target group** field and Ansible gains a **group** inventory source: name a tag and the step fans out to every host carrying it (SSH uses each host's user/port; Ansible builds the inventory). Groups combine with an explicit host list on SSH.
- Hosts persist per project (`/api/infrastructure`) and resolve at execution time; a test covers persistence + group resolution.

## v0.3.1 — 2026-07-21

- Hosted forms get unguessable `/forms/<uuid>` paths by default (like webhooks/git).

## v0.3.0 — 2026-07-21

- **Exit tool** (`logic.exit`) — stop a run early with a reason; downstream steps are skipped. Two new sample blueprints (Loop fan-out, Exit-early) → **34 tools, 32 blueprints**.
- **Branch lanes are now tabs** — scale to many lanes and edit one at a time; delete the last lane, cleaner active-tab contrast, no stray connector.
- **Requirements documented** — README and User Guide now state plainly that running steprail needs only Docker (ports 8451/8452); Anthropic key + service connections are optional and set in the UI; Node 22 is only for development.
- Repository made public, so the `curl … install.sh | sh` one-liner works for anyone (raw fetch + clone + image pull no longer need auth).

## v0.2.0 — 2026-07-20

First tagged release. The rail editor, real queue-backed execution, MCP in both
directions, and a hardened credential path are all in place; this cut adds the
authoring, documentation, and operability layers on top.

### Added
- **StepHan authoring assistant** — turn a sentence into a complete, runnable flow (Opus 4.8), with a system-level Anthropic key that works across projects. StepHan writes each flow's documentation as it drafts it, shows a live "working" indicator, and now **modifies the open flow in place** ("add a Slack alert if it fails") while keeping everything you didn't change — undo one keystroke away.
- **Per-flow documentation** — every flow carries a Markdown write-up plus an auto-generated, category-tinted **Mermaid diagram** of the rail. Read it in the Docs panel, edit the prose, or copy/download as Markdown (the diagram travels as a ` ```mermaid ` block that renders on GitHub/Scrivenry/Notion). Reachable from the editor and the Flows list.
- **Save any flow as a blueprint** in one click from the editor toolbar.
- **Persistent analytics** — Reports keeps a per-project daily rollup (30-day chart + all-time totals) that outlives the capped run history, so it no longer collapses to "just today".
- **Dynamic form fields** — a form's choice dropdown can populate from any JSON API (SSRF-hardened). Terraform inline HCL; a full **Git** step (clone/commit/push/pull/merge/tag); Ansible inventory from inline or git; three Ansible starter blueprints.
- **Postgres backend** option (`STEPRAIL_DB_URL`) alongside the default SQLite.
- **Operability** — Prometheus `/api/metrics`, `/api/ready` readiness probe, graceful SIGTERM/SIGINT shutdown, zero-downtime encryption-key rotation.

### Changed
- Flows list gains enable/disable and duplicate; palette gets category web-icons and animation; StepHan is a bigger avatar button.
- README, User Guide, and a new **Deploy Guide** (`docs/DEPLOY.md`) documenting persistence, TLS, the production checklist, and publishing your own image.

### Testing / CI
- Three test layers now gate every push: unit (reducer/flow model/engine/diagram/markdown), server integration (real server on a temp data dir), and **browser E2E** (Playwright/Chromium: run a flow, read the OTel trace, prove an unconnected step fails in plain language, docs panel, save-as-blueprint). ESLint (flat) + strict `tsc` + build.

### Security
- Secrets AES-256-GCM at rest (write-only; `has*` flags to the browser). Per-IP rate limits and hardened headers on public surfaces; strict CSP on hosted form pages. CLI executors reject flag-smuggling; the GitHub token never touches argv. SSRF-hardened outbound lookups pin the validated IP (no DNS-rebinding window). Optional constant-time API access token.

### Notes
- Analytics retention applies going forward; history from before this release (beyond the last 40 runs) was not retained and can't be recovered.
- Multi-instance HA remains a planned follow-on; this release is single-instance.
