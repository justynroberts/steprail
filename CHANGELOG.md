# Changelog

All notable changes to steprail. Dates are ISO; versions follow SemVer while pre-1.0.

**Versioning:** the version in `package.json` is bumped on every substantive change and surfaced at `/api/health` (`version`) and in the app, so anyone testing a build can tell exactly which one they're on. Tag (`git tag vX.Y.Z && git push --tags`) when cutting a release.

## v0.5.12 — 2026-07-23

- **Approval links work on Railway with zero config.** The approve/reject link no longer depends solely on the Public URL setting (which needs a signed-in save). The public origin now resolves in priority order: the **Public URL** setting → `STEPRAIL_PUBLIC_URL` env → **`RAILWAY_PUBLIC_DOMAIN`** (Railway injects this automatically, so hosted approvals just work) → the origin captured from inbound requests (covers any reverse proxy). So a Railway deploy gets a one-click approval button in email/Slack without touching Setup at all.

## v0.5.11 — 2026-07-23

- **Silent auth failures are gone.** When a stored session token is rejected (a stale login on a hosted, login-gated instance), the client now clears it and drops to the sign-in screen — instead of letting writes like the Public URL / Setup saves fail with no feedback. That silent 401 is why a typed Public URL sometimes never persisted on Railway after the session went stale.

## v0.5.10 — 2026-07-23

- **Setup free-text fields save reliably.** Public URL, OTLP endpoint, and Email-from now persist **once on blur** instead of firing a save on every keystroke — the per-keystroke saves could race over a slower hosted (Railway) round-trip and land a stale partial value, which is why a typed Public URL sometimes didn't stick. Type/paste, click away, saved.

## v0.5.9 — 2026-07-23

- **Approval email footer no longer implies a link that isn't there.** When no Public URL is set (so there's no one-click button), the email now says “open steprail and go to Approvals” and points to the Public URL setting — instead of the misleading “this link is signed just for you.”

## v0.5.8 — 2026-07-23

- **Approval requests are now friendly + customisable.** The Approval step gains a **Message to approver** field — a standard note (tokens supported, e.g. “deploys {{var.service}} to production”) that leads every notification and the approval page. Approval **emails are now proper HTML** — the message up top, the flow/step, and a branded “Review & decide” button — instead of a raw text/JSON dump. Slack posts a tidy message with a linked call-to-action. The custom message also shows in the in-app inbox and on the hosted page.

## v0.5.7 — 2026-07-23

- **Approvals, properly.** The `logic.approval` gate goes from a bare in-app button to a real change-management control (see `docs/PRD-APPROVALS.md`):
  - **Signed magic-links = identity.** When a gate parks, each named approver is emailed (and Slack is posted) a signed `/approve/<token>` link. The token is HMAC-signed with a key derived from the server secret and encodes who it's for — holding a valid token = acting as that approver. It carries a TTL and dies once the gate is decided.
  - **One hosted approval page** (public, token-gated, rate-limited, strict CSP — like hosted forms) showing the **decision context** (the upstream step's output — the plan/diff/target) and Approve / Reject-with-reason.
  - **Reject with reason** cleanly stops the run (marks downstream skipped) and records why; a reason is required to reject.
  - **In-app Approvals inbox** — a new nav section listing every waiting gate across the project with the same Approve/Reject actions, plus a Reject button in the Run drawer.
  - **Decision audit report** — a persistent, in-app log of every approve/deny (who, when, via which channel, reason) that outlives the 40-run history cap.
  - New **Public URL** setting (Setup) so outbound approve/reject links resolve; blank keeps approvals in-app only.

## v0.5.6 — 2026-07-23

- **Email supports both HTTPS-API and pure-SMTP providers, selectable.** The Email step gains a **Send via** option — `auto` (default: Resend over HTTPS, any other provider over SMTP), `smtp` (force the SMTP transport for any provider, including Resend), or `api` (force Resend's HTTPS API). So you can run a pure-SMTP provider *and* Resend side by side and pick per step. (Reminder: pure SMTP only works where the host allows outbound SMTP — not on Railway/most PaaS, which block those ports; HTTPS-API providers work everywhere.) The failure-alerts email path now uses the same routing (Resend→HTTPS, else SMTP with hard timeouts) instead of a raw, timeout-less transport.

## v0.5.5 — 2026-07-23

- **Email works on Railway (and any host that blocks SMTP).** Most PaaS block outbound SMTP ports (25/465/587), so a Resend `smtp://` connection times out there — the send never leaves the box. Now a Resend connection is sent over **Resend's HTTPS API (port 443)** automatically, which is never blocked. No new config: the API key is already the password in the `smtp://resend:<key>@…` URL, so existing connections just start working after redeploy. The Settings **Test** button validates Resend the same way (over HTTPS). For non-Resend SMTP, a connection timeout now returns a plain-language message explaining the host likely blocks SMTP and to use an HTTPS-API provider.

## v0.5.4 — 2026-07-23

- **Clearer email failures + optional per-step From.** The #1 SMTP gotcha is a provider (Resend/SendGrid) accepting the login but rejecting the message because the From address is on an unverified domain — which read like a hang/obscure error. Now: a "domain not verified" rejection returns a plain-language message naming the address and pointing to a verified sender (`onboarding@resend.dev`) or domain verification; a missing From fails fast with the same guidance instead of silently using an unverified default; the Email step gains an optional **From** field; and Settings → Email from address now shows `onboarding@resend.dev` as the placeholder (was the unverified `steprail@fintonlabs.com`) with an inline hint.

## v0.5.3 — 2026-07-22

- **Never silently lose data on a hosted deploy.** A container on ephemeral storage (no volume mounted at the data dir) loses everything — flows, targets, secrets — on the next redeploy, and an auto-generated encryption key in that volume makes secrets unrecoverable. Three new guards close this off: (1) a production start **refuses to boot without `STEPRAIL_ENCRYPTION_KEY`** (opt out with `STEPRAIL_ALLOW_EPHEMERAL_KEY=1`; the bundled local compose does, since it mounts a persistent named volume); (2) booting to an **empty data directory in production** logs a loud warning and reports `storageWarning` at `GET /api/health`, backed by a per-boot persistence heartbeat; (3) the UI shows an **unmissable banner** when that warning is present. New DEPLOY.md § Persistence spells out the two must-haves for Railway/Fly/etc.: a persistent volume at `/app/data` **and** a fixed `STEPRAIL_ENCRYPTION_KEY`.

## v0.5.2 — 2026-07-22

- **SMTP no longer hangs.** Email connections now build the transport with explicit `secure` handling (`smtps://` or `:465` → implicit TLS; otherwise STARTTLS via `requireTLS`, the port-587 path Resend/SendGrid/etc. expect) **and hard timeouts** (connection/greeting/socket). Before, a stalled handshake would hang the "Test" button and any `notify.email` step forever because nodemailer sets no timeouts by default and the test's `verify()` wasn't time-boxed — now it fails in seconds with a plain-language message ("no response within 15s — check host/port…"). Verified against Resend on both 587 and 465.



- **Security: no usable default login password in production.** The built-in `automation` is public, so a production deploy now **refuses to start** unless you set `STEPRAIL_LOGIN_PASSWORD` (or `STEPRAIL_LOGIN_DISABLED=1`) — it never fails open on a known secret. Local compose ships `STEPRAIL_LOGIN_DISABLED=1` (localhost isn't exposed); remove it and set a password when exposing.

## v0.5.0 — 2026-07-22

- **Front-door login** — a username/password screen gates the whole app (defaults **steprail / automation**, set `STEPRAIL_LOGIN_USER` / `STEPRAIL_LOGIN_PASSWORD`). On by default in production (Docker/Railway), off for local `make dev` unless a password is set; `STEPRAIL_LOGIN_DISABLED=1` disables it. Login exchanges credentials (constant-time compare, rate-limited) for a stateless session token that rides the existing `x-api-token` gate. **Change the default password before exposing.**

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
