# steprail — Multi-user & Enterprise Execution Plan

**Goal**: take steprail from a single-operator tool to a multi-user system with real
authentication, per-project authorization, isolated execution, and HA-capable
robustness — without rebuilding the parts that are already right (rail/tree model,
tool catalog, token resolution, portable flow JSON, event-sourced queue, plain-language
errors).

**Status**: plan. Stages are strictly ordered where marked; estimates assume one
focused engineer who knows the codebase.

---

## Current state (what this plan builds on)

| Area | Today | Enterprise gap |
|---|---|---|
| Identity | None. Optional single global API token (`apiToken`, timing-safe) | No users, no sessions, no SSO |
| Authorization | Projects segment flows/runs/secrets/config; secret + config resolution enforced server-side at execution (`scopeSettings`, `scopedGlobals` in `server/queue.mjs`) | API itself is unauthenticated; any browser sees/CRUDs everything |
| Flows API | `GET/PUT /api/flows` — **whole array**, last write wins | Two writers clobber each other; no concurrency control |
| Storage | JSON files in `data/` (`flows.json`, `settings.json`, `queue.json`, `projects.json`, `blueprints.json`), atomic tmp+rename, 0600 | Whole-file rewrites; no row-level concurrency; runs pruned at 40 |
| Secrets | AES-256-GCM at rest (`server/secrets.mjs`), key from `STEPRAIL_ENCRYPTION_KEY` or `data/.encryption-key`, decrypt at readSettings boundary, redacted from errors, never sent to browser | Fine — carries forward as-is |
| Execution | Single in-process worker (250ms poll) in the **server container**; executors spawn real CLIs; `node:vm` for JS (not a security boundary); `docker.sock` mounted; operator `~/.ssh` mounted ro | Flow authors have arbitrary code exec on the server; no per-run isolation; no egress control |
| Robustness | Event-sourced queue, crash recovery (running→queued on boot), per-step CLI timeout (120s), retries w/ backoff on transient tools, OTel span per step | Single worker, single instance, no leases, no quotas, no run-level timeout |
| Audit | None (git history for flows only via export) | No who-did-what |

**Cross-cutting principles for every stage**

1. Never break the portable flow JSON or the tool catalog contract.
2. Every migration is automatic at boot (the projects + encryption migrations set the pattern: `migrateSettingsToProjects`, `encryptSettingsInPlace`).
3. Plain-language errors remain a product feature — auth failures included.
4. Each stage ships alone, behind the smallest possible flag, and the container image stays a single `docker compose up`.

---

## Stage 1 — Storage engine + per-flow API *(prerequisite for 2 and 4)*

**Objective**: replace whole-file JSON with a real database and whole-array flow
saves with per-flow CRUD + optimistic concurrency. After this stage, two writers
cannot clobber each other and run history is durable.

**Decision to make first**: Postgres (already in `docker-compose.yml` as the demo
DB) vs SQLite (`better-sqlite3`, zero-ops). Recommendation: **Postgres** — Stage 4
(multi-worker `SKIP LOCKED`, scheduler leases) needs it; SQLite would mean doing
this twice. Keep the demo `postgres` service, add a `steprail` database in it.

### Steps

1.1. **Add a storage module** `server/db.mjs`
  - `pg` is already a dependency (used by the postgres executor).
  - Connection from `STEPRAIL_DATABASE_URL` env (bootstrap exception, like `PORT`);
    default to the compose-internal `postgres://newflow:newflow@postgres:5432/steprail`.
  - Schema bootstrap on boot (idempotent `CREATE TABLE IF NOT EXISTS`):
    - `projects(id text pk, name text unique, color text, created_at timestamptz)`
    - `flows(id text pk, project_id text refs projects, name text, doc jsonb, active bool, updated_at timestamptz)` — `doc` holds steps/vars/tags verbatim (the tree stays a document; no step normalization)
    - `settings(key text pk, value jsonb)` — one row per top-level settings key; secrets stay encrypted strings inside `value`
    - `runs(id text pk, flow_id text, project_id text, doc jsonb, running bool, started_at, finished_at)` — `doc` = statuses/outputs/errors/entries/spans/tokenOutputs snapshot
    - `queue_events(id text pk, run_id text, state text, not_before timestamptz, doc jsonb)` with index on `(state, not_before)`
    - `blueprints(id text pk, doc jsonb)`
    - `memory(project_id text, key text, value jsonb, pk(project_id,key))` — moves `data.memory` off its current settings-adjacent storage
  - Small sync-looking async API mirroring today's four storage touchpoints in
    `queue.mjs` (`persist`, boot load, `readFlowsFile`, `readSettings`) so the
    worker logic above them does not change.

1.2. **Boot migration from JSON** (one-way, automatic)
  - On first boot with a DB configured: if `data/flows.json` etc. exist and tables
    are empty, import everything, then rename the JSON files to `*.imported`.
  - Keep `data/.encryption-key` on disk exactly as now (the DB stores ciphertext).
  - Abort boot with a plain-language error if the DB is unreachable — no silent
    fallback to files (split-brain risk).

1.3. **Per-flow API** in `server/index.mjs`
  - `GET /api/flows` → list (project-filterable `?projectId=`), each with `updatedAt`.
  - `POST /api/flows` → create one.
  - `PUT /api/flows/:id` → update one; body carries `ifUpdatedAt`; mismatch → **409**
    `{error: "This flow changed in another window — reload it before saving."}`.
  - `DELETE /api/flows/:id`.
  - Keep `PUT /api/flows` (whole array) for one release as a deprecated shim, then remove.
  - `armSchedules` re-arms from DB on any flow write.

1.4. **Client rework** (`src/App.tsx`, `src/api.ts`, `src/state.tsx`)
  - Autosave saves only the **active flow** (debounced, with `ifUpdatedAt`).
  - Create/delete/rename call the per-flow endpoints directly.
  - 409 handling: toast + "Reload flow" action (drop local, refetch).
  - FlowsHome fetches the project's flows only (`?projectId=`), killing the
    all-projects download.

1.5. **Run history**
  - Runs written to `runs` table as they progress (the existing `persist()` call
    sites); prune policy becomes a retention setting (default 90 days / 10k runs)
    instead of "last 40 in RAM". `getReportData` reads from SQL (counts by day become
    a query). RunDrawer gets pagination (`?before=`).

1.6. **Verification gate**
  - Two browser sessions editing different flows in different projects concurrently:
    zero lost writes.
  - Same flow in two windows: second save gets the 409 toast.
  - Kill -9 the server mid-run → run resumes on boot (event states recover as today).
  - Reports show >40 runs.

**Effort: ~1.5 weeks.** Risk: the client autosave rework is the fiddly part; the
queue storage swap is intentionally mechanical.

---

## Stage 2 — Identity, RBAC, audit *(depends on Stage 1)*

**Objective**: real users, sessions, per-project roles, and an audit trail. The
`projectId` already on every record becomes the authorization key it was designed
to be.

### Steps

2.1. **Users + sessions** (`server/auth.mjs`, new)
  - `users(id, email unique, name, password_hash nullable, created_at, disabled)`;
    argon2id hashing (`argon2` dep).
  - Cookie sessions: `sessions(id, user_id, expires_at)`, `HttpOnly; Secure; SameSite=Lax`,
    30-day sliding expiry. No JWTs — sessions are revocable and simpler to audit.
  - CSRF: double-submit token for state-changing routes (or strict same-origin check
    via `Origin` header — sufficient given the SPA is same-origin).
  - Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - **First-run bootstrap**: if zero users exist, `/api/auth/setup` creates the first
    admin (the Setup page grows a create-admin card; until then all other routes 401).
  - The legacy global `apiToken` becomes a **service token** for automation
    (webhook-adjacent API use), scoped read-only or per-project in 2.4.

2.2. **OIDC SSO** (behind config; local users keep working)
  - `openid-client` against a configurable issuer (Okta/Entra/Auth0/Keycloak).
  - Settings (Setup page, admin-only): issuer URL, client id/secret (encrypted like
    other secrets), allowed email domain, default role for JIT-provisioned users.
  - Login page shows "Sign in with SSO" when configured.

2.3. **RBAC** (`server/authz.mjs`, new)
  - `grants(user_id, project_id, role)` with roles:
    - `viewer` — read flows/runs/reports; no secrets metadata
    - `editor` — viewer + flow CRUD, run, test-step, config values
    - `admin` — editor + secrets CRUD, project rename/delete, member management
    - instance-level `owner` flag on users for cross-project administration + Setup
  - Middleware `requireProject(role)` resolving the project from the route/body,
    applied to **every** `/api/*` route in `index.mjs` (~25 routes; the audit of which
    route needs which role is step one of this task and gets written into the doc).
  - Execution-time checks stay exactly where they are (`scopeSettings` etc.) —
    defense in depth, not replaced by the HTTP layer.
  - **Server-side entry points** (webhooks `/hooks/*`, forms `/forms/*`, MCP `/mcp`,
    schedules) are *not* user-authenticated by design; they authenticate by path
    secrecy/HMAC as today and run as the flow's project. Documented explicitly.
  - UI: project switcher lists only granted projects; Members panel in the switcher
    popover (admin-only): invite by email, set role, remove.

2.4. **Per-project service tokens**
  - `tokens(id, project_id, role, hash, created_at, last_used)` — replaces the single
    global `apiToken` for programmatic access; shown once at creation.

2.5. **Audit log**
  - `audit(id, at, user_id nullable, project_id, action, subject, detail jsonb, ip)`.
  - Emit from one helper called in the routes: `flow.create/update/delete`,
    `run.start`, `run.approve`, `secret.create/replace/delete/test`, `config.update`,
    `project.*`, `auth.login/fail`, `member.*`, `token.*`.
  - Reports page gains an admin-only Audit tab (filter by project/user/action, export CSV).
  - Approvals (`logic.approval`) record the real approving user id, not free text.

2.6. **Verification gate**
  - Fresh install forces admin creation; unauthenticated API returns 401 everywhere
    except health/hooks/forms/mcp.
  - viewer cannot read secret metadata or save flows (403 with plain message).
  - A user with no grant on project B cannot list B's flows even with a crafted request.
  - Audit rows appear for every mutating action; login failures logged with IP.
  - OIDC round-trip against a Keycloak test container.

**Effort: ~2 weeks.** Risk: OIDC edge cases; mitigate by shipping local-users first
and treating SSO as a fast-follow within the stage.

---

## Stage 3 — Execution isolation *(independent of 1–2; the biggest security lift)*

**Objective**: flow execution moves out of the server process into per-run ephemeral
runner containers, so a flow author can no longer execute code on the server host,
and project secrets are only ever materialized inside the run that owns them.

### Steps

3.1. **Threat-model doc first** (half a day, in this file's folder): what a malicious
  flow author can reach today (server FS, encryption key, all projects' secrets via
  process memory, docker.sock = host root, operator's ~/.ssh) and which of those each
  sub-step closes. This doc is also the enterprise security-review artifact.

3.2. **Runner image** (`docker/runner/Dockerfile`)
  - The CLI toolchain moves here from the server image: ssh/sshpass, ansible, git,
    kubectl, aws-cli, terraform, psql. The **server image loses them all** plus the
    docker.sock and `~/.ssh` mounts.
  - Non-root user, read-only rootfs, tmpfs `/tmp` and `/work`, `no-new-privileges`,
    all capabilities dropped, pids/memory/cpu limits.

3.3. **Runner protocol** (`server/runner.mjs`)
  - Worker leases an event → instead of `executeStep()` in-process, it POSTs a
    **step job** to a runner: `{toolId, resolvedConfig, input, scopedSecrets}` and
    receives `{output | plainError}`.
  - Transport v1: spawn a sibling container per **run** (not per step — startup cost
    amortized, and a run is the natural trust boundary): server ↔ runner over a
    loopback HTTP socket with a one-time bearer token injected at spawn; runner exits
    when the run finalizes or on `runTimeout`.
  - Container creation via a **narrow spawner**: a tiny privileged sidecar service
    that only knows "start runner image with these limits" — the app server itself
    still never gets docker.sock. (K8s flavor later swaps the sidecar for a Job.)
  - Secrets: only the owning project's connections are sent, per step, already
    decrypted — the encryption key never leaves the server; runner keeps nothing on disk.
  - `js`-only steps (`data.transform`, conditions): run in the runner too — `node:vm`
    stops being load-bearing for security.
  - `data.http` steps execute in the runner with the **egress policy** applied (3.4).
  - Streaming: runner posts per-step results as they finish; server marks
    statuses/spans exactly as today (no UI change).

3.4. **Egress policy** (SSRF control)
  - Per-project allowlist/denylist for outbound HTTP (Setup, admin-only): default
    policy blocks RFC1918 + link-local + the compose network except explicitly allowed
    hosts. Enforced in the runner's fetch path with plain-language refusal
    ("this project's egress policy blocks 10.0.0.5 — an admin can allow it in Setup").
  - SSH/Ansible/psql targets are exempt by nature but logged to audit.

3.5. **Decommission the standing liabilities**
  - Remove `${HOME}/.ssh` mount (named per-project secrets are the only path now;
    release note for keyless-ssh users).
  - Remove docker.sock from the server; `infra.docker` builds run in the runner via
    the spawner sidecar or get an explicit "requires runner privileges" setting.
  - `known_hosts` moves per-project into the DB, injected into runners (TOFU records
    survive runner ephemerality).

3.6. **Fallback + rollout**
  - `executionMode: inprocess | container` setting; default stays `inprocess` until
    the runner soak-tests, then flips. In-process mode prints a startup warning once
    multi-user (Stage 2) is enabled.

3.7. **Verification gate**
  - A transform running `process.mainModule`/`require` escape attempts: contained
    (runner has no server code, no key, no other project's secrets).
  - HTTP step to `http://postgres:5432` from a default-policy project: refused.
  - SSH fleet + ansible + terraform blueprints run green end-to-end in runner mode.
  - Server container ships without ssh/ansible/terraform binaries at all (trivy SBOM
    diff shrinks accordingly).
  - Runner soak: 100 sequential runs, no container leaks (`docker ps` clean).

**Effort: ~2–4 weeks** (2 for docker-spawner v1 with the flag, the rest for egress
policy + hardening + soak). Highest-risk stage; the flag keeps it shippable.

---

## Stage 4 — Execution robustness & HA *(depends on Stage 1; better after 3)*

**Objective**: multiple workers, multiple server replicas, quotas, and no
double-firing schedulers — the queue semantics (waits, approvals, loops, retries)
must survive unchanged.

### Steps

4.1. **Multi-worker queue**
  - Event claim becomes `UPDATE queue_events SET state='running', lease_until=now()+'60s' WHERE id IN (SELECT … WHERE state='queued' AND not_before<=now() ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`.
  - Lease expiry sweeper re-queues events whose worker died (replaces the boot-time
    running→queued recovery, which stays as a belt-and-braces path).
  - Worker id + heartbeat table for observability.
  - **Ordering invariant**: events of one run must not interleave across workers —
    claim at run granularity (skip events whose run is leased elsewhere). This
    preserves today's per-run sequential semantics including lanes.

4.2. **Run-level controls**
  - `runTimeout` (default 30m, per-flow override in flow settings): exceeded →
    remaining steps marked error "run exceeded its time budget", runner killed.
  - Per-project quotas (Setup, admin): max concurrent runs, max runs/hour, max loop
    iterations override. Exceeded → queued-with-reason or refused at trigger with a
    plain message (webhook gets 429).
  - Idempotency: webhook trigger accepts optional `Idempotency-Key` header; duplicate
    key within 24h returns the original run id instead of a new run.

4.3. **Scheduler HA**
  - `armed` map moves to a `schedules` table (`flow_id, next_at, locked_by, locked_until`);
    any replica claims due schedules with the same SKIP LOCKED pattern. Misfire
    policy: fire-once-if-late (>1 interval late → skip with an audit row, don't storm).

4.4. **Multi-replica servers**
  - Already stateless once Stage 1 lands except: run polling (client polls any
    replica — fine, DB-backed), and `/mcp` long-poll waits (fine, reads DB).
  - Compose/Helm examples: 2 replicas + shared PG behind any TCP LB; health endpoint
    gains a `db: ok` field.
  - Graceful shutdown: SIGTERM → stop claiming, finish leased events (bounded 30s),
    release leases.

4.5. **Operational visibility**
  - `/api/metrics` (Prometheus text): queue depth, event age p95, runs by status,
    worker heartbeats, runner spawn latency.
  - Reports page: queue health card (admin).

4.6. **Verification gate**
  - 3 workers, 200 concurrent runs incl. loops/branches/waits: zero interleaved runs,
    zero double-executed steps (assert by span count per step id).
  - Kill a worker mid-run: lease expires, run completes on another worker.
  - Two replicas + one schedule: exactly one firing per occurrence over 24h.
  - Quota breach returns 429 with plain-language body; approval waits survive a full
    rolling restart.

**Effort: ~1–2 weeks.**

---

## Stage 5 — Enterprise trim *(à la carte; each item independent)*

| Item | What ships | Effort |
|---|---|---|
| 5.1 Flow versioning | `flow_versions` table written on every save (author, ts, doc); History drawer with diff (reuse portable-JSON diff), one-click rollback (creates a new version); replaces "session-only undo" story for teams | 3–4 d |
| 5.2 Approvals v2 | `logic.approval` requires role ≥ editor or a named approver group; email/Slack notification with a signed deep link; audit-recorded decision + comment | 2–3 d |
| 5.3 SCIM 1.0 | `/scim/v2` Users + Groups against the users/grants tables (deprovisioning = disable + revoke sessions); groups map to per-project roles | 4–5 d |
| 5.4 Backup/restore | `steprail backup` (pg_dump + key fingerprint manifest) and documented restore drill; retention job for runs/audit | 2 d |
| 5.5 Rate limiting & headers | Per-IP and per-token limits on auth + hooks; CSP, HSTS, frame-ancestors, nosniff on the SPA; cookie hardening pass | 1–2 d |
| 5.6 Compliance artifacts | SBOM generation in CI (`trivy` — pattern exists in docs/sbom.cyclonedx.json), image signing (cosign), pinned base images by digest, `SECURITY.md` + threat model from 3.1 kept current | 2 d |
| 5.7 Notifications | Per-user email/Slack on run failure / approval requested for flows in granted projects (digest option) | 2–3 d |
| 5.8 Data export | Project export (flows as portable JSON + config, minus secrets) / import — tenant portability story | 1–2 d |

**Effort: ~2–4 weeks depending on selection.** Recommended minimum for "enterprise
ready" label: 5.1, 5.2, 5.4, 5.5, 5.6.

---

## Sequencing summary

```
Stage 1  Storage + per-flow API   ██████████░  ~1.5 wk   (prereq for 2, 4)
Stage 2  Identity + RBAC + audit  ██████████████  ~2 wk   (needs 1)
Stage 3  Execution isolation      ████████████████████  ~2–4 wk  (independent; start anytime)
Stage 4  Robustness + HA          ██████████  ~1–2 wk   (needs 1; best after 3)
Stage 5  Enterprise trim          ██████████████  ~2–4 wk (à la carte)
                                   ─────────────────────
                                   ~6 wk minimum credible team-ready (1,2,3-v1,4)
                                   ~3–4 months to full enterprise posture
```

Parallelization: Stage 3 can run alongside 1–2 if a second engineer exists; nothing
else safely parallelizes.

## Out of scope (deliberately)

- Rewriting the flow model, tool catalog, or portable JSON format.
- Multi-region/active-active; billing/metering; a hosted SaaS control plane.
- Per-step (rather than per-run) sandbox granularity — revisit only if untrusted
  *tools* (marketplace) ever become a feature.
