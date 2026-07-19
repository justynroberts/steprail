<!-- MIT License - Copyright (c) fintonlabs.com -->
# steprail — Production Readiness Plan

An honest roadmap from "impressive prototype" to "runs in production without surprising you at 3am." Grounded in the current architecture: a single Node process, a JSON-file event queue, `node:vm` execution, per-project scoping, no auth beyond an optional shared token.

## 0. Decide the target first (this changes everything)

The amount of work depends entirely on **who is allowed to author flows**:

| Track | Who authors flows | Effort | The hard part |
|---|---|---|---|
| **A — Self-hosted, trusted operators** (recommended default) | You / a small trusted team | Moderate | Durability + ops. The trust model already holds. |
| **B — Multi-tenant / untrusted users** | Anyone with a login | Large (2–3× A) | The `node:vm` sandbox and open egress must be *replaced*, not tuned. |

**Recommendation:** target **A** first. It's the realistic destination for a self-hosted orchestrator, and every phase below is required for it. Track B adds Phases 6–7 and a much heavier security bar; don't pay for it until a real untrusted-multi-tenant use case exists. The single most important decision: **if untrusted users are ever in scope, `node:vm` and `data.http`'s open egress are disqualifying and must be solved before launch — no exceptions.**

The rest of this plan assumes Track A, and flags the extra Track-B work inline.

---

## Phase 1 — Confidence: tests + CI gates  *(do this first; highest leverage, lowest cost)*

**Why:** every real bug this cycle (StepHan's `temperature` fallback, the `/api/form-options` crash, the tutorial append bug, three security holes) was caught by hand or by an external reviewer — **not by the suite**. The safety net has holes exactly where change is happening.

- **Expand the server/engine suite** (`tests/`): every executor's success *and* error path, token resolution edge cases, `optionsFromResponse`, `safefetch` guard table, the queue state machine (waiting→queued→running, retries, approvals, loops, crash recovery).
- **Add a frontend test layer** (Vitest + Testing Library): the reducer in `src/state.tsx` (insert/move/remove/branch/undo on the tree), `SlotPath` targeting, `flowjson` round-trips, form-builder + dynamic-option UI. There is currently **zero** frontend test coverage.
- **E2E smoke** (Playwright, headless): create-run-a-flow, a hosted-form submission, StepHan compose, import/export. Wire it to the same oracle.local pattern already used manually.
- **CI pipeline** (GitHub Actions): on every PR run `tsc --noEmit`, `npm test`, the E2E smoke, and a linter — **block merge on failure.** Add ESLint (the repo has none; `tsc` alone missed the bugs above).
- **Coverage gate:** start at whatever today is, ratchet up; fail CI on regressions.

**Exit criteria:** no merge to `main` without green typecheck + unit + E2E; a deliberately reintroduced version of each past bug is caught by a test.

---

## Phase 2 — Durability: replace the JSON files with SQLite

**Why:** the queue and all persistence are JSON files rewritten in place (`data/*.json`). A crash mid-write, a full disk, or two writers and you lose or corrupt state. This is the biggest single risk to "won't surprise you."

- **Migrate persistence to SQLite (WAL mode).** The README already claims the queue swap is "four functions" — cash that cheque. Flows, runs, settings, projects, and the event queue become tables; writes become transactions. Atomic, crash-safe, concurrent-reader-safe, and it unblocks Phase 4.
- **Schema + migrations:** a versioned migration runner; every release migrates forward cleanly. Add a boot-time integrity check.
- **Backups:** scheduled SQLite `.backup`, retention, and a documented + *tested* restore. "Backup verify" is a stated skill — make it real here.
- **Idempotency:** dedupe webhook/schedule deliveries; make executors safe to retry (they mostly are — audit the ones with side effects: `notify.*`, `data.postgres` writes, `infra.*`).

**Exit criteria:** `kill -9` the process mid-run and restart with zero corruption and correct resume; a full-disk write fails a single run, not the datastore.

---

## Phase 3 — Secrets & config for real deployments

**Why:** the encryption key auto-generates into `data/.encryption-key`. That's fine for a laptop, wrong for prod (key in the same volume as the ciphertext; no rotation).

- **Key management:** require `STEPRAIL_ENCRYPTION_KEY` from the environment / a mounted secret in prod (warn loudly if auto-generating). Add **key rotation** (re-encrypt on new key) instead of the current "changed key = all secrets dead."
- **Optional external secret store:** interface for Vault / cloud KMS behind the existing `secrets.mjs` boundary.
- **Config surface:** document every env var (`PORT`, `STEPRAIL_ENCRYPTION_KEY`, `STEPRAIL_TRUST_PROXY`, OTLP endpoint); keep UI-first config but make the bootstrap/secret set explicit and validated at boot.

**Exit criteria:** a fresh prod deploy fails fast with a clear message if the encryption key isn't externally provided; rotating the key doesn't lose secrets.

---

## Phase 4 — Scale & availability: split web from worker

**Why:** one process does the API, the scheduler, and the worker loop. It can't scale horizontally and any restart pauses everything.

- **Separate processes:** a stateless web/API tier and one or more worker processes, sharing the datastore. With SQLite this is single-host multi-process; for true HA, make the datastore **Postgres** and use `SELECT … FOR UPDATE SKIP LOCKED` to hand out queue work.
- **Scheduler leader election** so armed schedules fire once across N instances.
- **Graceful shutdown + readiness vs liveness probes** (a `/api/health` liveness exists; add readiness that reflects datastore + worker).
- **Backpressure & limits:** per-run step caps, global concurrency caps, run timeouts, and a dead-letter path for poison events.

**Exit criteria:** run two web + two worker instances behind a load balancer; kill any one with no dropped or duplicated runs; a schedule fires exactly once.

---

## Phase 5 — Operability: see it, alert on it, run it

**Why:** OTel traces are great for a single run; you also need fleet-level signal and a way to be paged.

- **Metrics (Prometheus/OpenMetrics):** queue depth, runs/sec, error rate, step latency histograms, retry/approval counts, worker saturation. Traces answer "why was this run slow"; metrics answer "is the system healthy."
- **Structured logging** with levels and request/trace ids (trace ids already exist); ship to a log store.
- **Alerting + runbooks:** wire the existing failure-alert path to on-call; write runbooks for queue backlog, worker down, datastore full, key mismatch.
- **Hardened container:** non-root user, read-only rootfs where possible, dropped capabilities, pinned + scanned base image, resource limits in compose/helm. (Today the image runs the bundled CLIs as root.)
- **TLS:** ship a reference reverse-proxy (Caddy/nginx) compose profile; never expose plain HTTP past the LAN.

**Exit criteria:** a Grafana board shows system health; killing a worker pages someone; the container passes a basic image scan and runs non-root.

---

## Phase 6 — Multi-user & access control  *(required for Track B; nice-to-have for A teams)*

- **Real authentication** (OIDC/SSO or local users) replacing the single shared token; sessions, not one API key.
- **RBAC bound to projects** — the PRD already anticipates this. Roles: viewer / author / operator / admin, enforced server-side at every mutation and run.
- **Audit log:** who created/edited/ran/deleted what, and every secret *use* (not value). Immutable, exportable.
- **Per-user rate limits and quotas** once identity exists (the current limiter is per-IP).
- **Optimistic concurrency** for editing — today autosave is last-write-wins; multiple editors will clobber each other.

**Exit criteria:** two users with different roles see and can do exactly what their role allows; every privileged action is attributable in the audit log.

---

## Phase 7 — Untrusted execution  *(Track B only — the hard wall)*

Only if untrusted users author flows. This is a rebuild of the execution boundary, not a patch.

- **Replace `node:vm`** (not a security boundary) with `isolated-vm`, a locked-down worker/subprocess, or per-run containers (gVisor/Firecracker for real isolation) with CPU/memory/time limits.
- **Egress allowlist for `data.http`** and all outbound fetches; deny by default. (The SSRF guard on form lookups is the pattern; generalise it.)
- **HMAC-signed webhooks** and per-endpoint auth for `/hooks/*`.
- **Per-tenant resource quotas, cost accounting, and abuse detection.**

**Exit criteria:** a deliberately hostile flow (fork bomb, crypto-miner, internal-network scan, secret exfiltration) is contained and killed, not just slowed.

---

## Suggested sequencing & rough effort

| Order | Phase | De-risks | Rough size |
|---|---|---|---|
| 1 | **Tests + CI** | Regressions, silent breakage | S–M |
| 2 | **SQLite durability** | Data loss / corruption | M |
| 3 | **Secrets/key mgmt** | Prod secret handling | S |
| 4 | **Web/worker split + HA** | Availability, scale | M–L |
| 5 | **Metrics/logging/hardening** | Blind operation | M |
| 6 | Auth/RBAC/audit | Multi-user safety | L (needed for teams / Track B) |
| 7 | Untrusted sandbox | Hostile-tenant safety | XL (Track B only) |

Phases 1–5 make steprail a **dependable self-hosted product for trusted operators** — that's the honest, reachable "production ready." Phases 6–7 are the tax for opening it to people you don't trust; don't pay it speculatively.

## The minimum bar (definition of "production ready" for Track A)

- [ ] CI gates every merge (typecheck + unit + E2E + lint); coverage doesn't regress.
- [ ] Datastore is transactional and crash-safe; restore is tested.
- [ ] Encryption key comes from the environment; rotation works.
- [ ] Web and worker can restart independently without dropping/duplicating runs.
- [ ] Metrics + alerting exist; there's a runbook for the top 5 failures.
- [ ] Container runs non-root behind TLS; base image is pinned and scanned.
- [ ] A documented backup/restore and upgrade/migration path.

Everything above is achievable without abandoning what makes steprail good — the rail, the tree model, real execution, MCP, and OTel all survive the move to SQLite + split processes unchanged. This is hardening the foundations under a design that's worth hardening.
