# Changelog

All notable changes to steprail. Dates are ISO; versions follow SemVer while pre-1.0.

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
