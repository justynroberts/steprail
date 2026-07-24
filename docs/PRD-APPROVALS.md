<!-- MIT License - Copyright (c) fintonlabs.com -->

# PRD: Approvals

## Problem

steprail's `logic.approval` step parks a run until a human approves. The
machinery is sound (persisted `waiting` event; `approve()` re-queues it; survives
restart) but the surrounding model is thin for the change-management use cases it
gates — `terraform apply`, prod Ansible, k8s rollback:

- **Authorization is theater.** The `approver` field is a display label. Anyone
  with app access can approve; `approvedBy` is effectively `"ui"`. The audit
  record doesn't prove *who* acted.
- **Nobody is told.** The run sits `waiting`; the approver must happen to be
  watching the Run drawer. No out-of-band reach.
- **No deny path.** You can approve or leave it hanging forever — no
  reject-with-reason that cleanly stops the run.
- **No decision context.** The approver sees a step name, not the plan/diff/target.

## Goals (v1)

A **solid slice**, forward-compatible with RBAC:

1. **One hosted approval surface** at `/approve/<token>` (mirrors hosted forms:
   public, token-gated, rate-limited, server-rendered, strict CSP).
2. **Signed-link identity.** A per-approver HMAC token *is* the identity —
   possessing a valid token for `alice@co` = acting as Alice. Recorded on the run
   as `approvedBy` + `via: signed-link`.
3. **Multi-channel entry, one surface.** Email (magic link) and Slack (message
   with a link) both point at the hosted page; the in-app **Approvals inbox** and
   Run-drawer buttons hit the same resolve endpoint. Approvals ride on the
   existing email path (Resend HTTPS / SMTP) and Slack webhook.
4. **Approve or Reject-with-reason.** Reject reuses the `logic.exit` machinery:
   stop the run, mark downstream skipped, record the reason as the outcome.
5. **Decision context.** The page shows the immediate upstream step's output
   (the terraform plan, the diff, the target host), rendered like a form.
6. **Audit trail.** Each decision recorded on the run (approver, decision,
   reason, timestamp, channel) and in the OTel trace.

## Require sign-in to approve (v1.1)

Optional toggle (`approvalRequireLogin` setting / `STEPRAIL_APPROVAL_REQUIRE_LOGIN`),
meaningful only when a login gate is active. When on, an approval can only be
made from an authenticated session, not the token alone:

- The email/Slack link deep-links into the app (`/?approval=<token>`) instead of
  the public page. The app is behind the login gate, so reaching the approval
  modal proves a valid session; the token scopes *which* gate.
- Decisions go through login-gated `/api/approval` (GET detail, POST decide).
- The public `/approve/<token>` page can't act (direct navigation + strict CSP
  can't see the header session) — it shows "Sign in to approve" and links into
  the app, so old/public links still funnel to the authenticated flow.

Use when all approvers have accounts (defense in depth over the magic link).
Leave off if any approvers are external/account-less.

## Roles (planned — RBAC)

The system is moving to three user classes, which bind to the tenant/project ids
already on flows, runs, and connections:

- **Authors** — create and edit flows, connections, config.
- **Approvers** — act on approval gates (and view runs). "Require sign-in to
  approve" is the first step: today it requires *a* valid session; with RBAC it
  will require a session **whose user holds the Approver role**, and the decision
  records that real user (not just the token's named approver).
- **Consumers** — trigger/run flows and view results, but not author or approve.

The signed-token identity + login gate is forward-compatible: the enforcement
point (`/api/approval`) is where the role check will slot in.

## Non-goals (deferred)

- **Timeout / reminder / escalation** — a pending gate blocks indefinitely for
  now (token carries a TTL, but no auto-expire of the run).
- **Multi-approver / quorum** — single approver in v1.
- **RBAC user accounts** — signed-token identity is the bridge; swap "valid
  token" for "authenticated user in role" later without changing the surface.
- **Native Slack action buttons** — needs a Slack app with an interactivity
  endpoint. v1 sends a Slack *message with a link*; native buttons are a
  fast-follow.

## Design

### Token
`base64url(payload).base64url(HMAC_SHA256(payload, K))`, where `K` is derived
from the server master key (`STEPRAIL_ENCRYPTION_KEY` / `data/.encryption-key`)
via `HKDF`/hash with a distinct label — never the raw AES key. Payload:
`{ runId, stepId, approver, projectId, iat, exp }`. Verified constant-time;
rejected if expired or if the event is no longer `waiting` (so a link is
single-use in effect — once decided, it's dead).

### Flow
1. Run hits `logic.approval` → event parks `waiting` (unchanged) → server mints a
   token per approver and **sends the request** (email and/or Slack) with the
   `/approve/<token>` link, plus posts to the in-app inbox.
2. Approver opens the link → hosted page shows flow/step/context + Approve /
   Reject (reason). In-app users see the same in the Approvals inbox.
3. `POST /approve/<token>` (or in-app `POST /api/runs/:id/approve|reject/:stepId`)
   verifies identity → `approve()` or `reject(runId, stepId, approver, reason)`.

### Server changes
- `secrets.mjs`: `signPayload(obj, ttlMs)` / `verifyPayload(token)`.
- `queue.mjs`: `reject()`; decision records on approve/reject; extract
  `sendEmail()` / `postSlack()` (shared by failure alerts + approval requests);
  `requestApproval(run, step, config)` invoked on park.
- `index.mjs`: `GET/POST /approve/:token`; in-app reject endpoint; identity
  recorded from token or session.
- shared: `renderApprovalHtml()` (approval page + success), escape-first.

### Client changes
- **Approvals** nav view: pending gates across runs, Approve/Reject inline.
- Run drawer: add **Reject** beside Approve; show decision outcome.
- `logic.approval` tool: keep `approver`; note that blank = in-app-only (no
  notification). `api.ts`: `rejectStep()`.

## Security

- Token signed with a derived key; constant-time verify; TTL; dead once decided.
- Hosted page: strict CSP (as forms), rate-limited, no secrets rendered.
- Identity is possession-of-token in v1 — documented as such; RBAC hardens it.

## Acceptance

- Approval step notifies via configured channel(s) with a working link.
- Hosted page shows real upstream context and both actions.
- Approve resumes; Reject stops the run with the reason recorded.
- `approvedBy` reflects the token's approver + channel in the run + trace.
- Build clean, server tests green, hosted page verified in a browser.
