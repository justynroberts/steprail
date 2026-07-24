<!-- MIT License - Copyright (c) fintonlabs.com -->

# PRD: Role-Based Access Control (RBAC)

Status: **spec / not implemented.** Captures the design for individual user
accounts and the three user classes (Authors, Approvers, Consumers) so approving,
authoring, and running are separated. Builds directly on the approval work
(`docs/PRD-APPROVALS.md`) and the existing project tenant boundary.

## Problem

Auth today is a **single shared account** (`STEPRAIL_LOGIN_USER` / `STEPRAIL_LOGIN_PASSWORD`,
stateless HMAC session token). Anyone who signs in has full power, and the server
can't tell *who* acted. steprail already has **projects as the tenant boundary**
(`projectId` on flows, runs, connections, secrets, config), and approvals now
require a session (0.5.14) — but not a specific identity. We need per-user
identity + roles bound to projects.

## Goals

1. **Individual accounts** with **per-project roles**.
2. Roles: **Consumer**, **Approver**, **Author**, plus an **Owner/Admin** to
   manage users and projects.
3. **Server-enforced** on every reading/mutating endpoint, scoped by project.
4. The recorded actor for approvals (and other actions) is the **real signed-in
   user**, not the token's named approver.
5. **Backward compatible**: existing single-password deployments keep working
   until an admin provisions users.

## Non-goals (v1)

- SSO / OIDC / SAML (planned follow-on; the identity layer is designed to admit it).
- Per-flow ACLs — roles are per-project, not per-object.
- Self-service signup — an Owner provisions users.

## Roles & permission matrix

Capabilities are the atoms; roles are bundles. Enforcement checks a capability
against the user's role **in the relevant project**.

| Capability | Consumer | Approver | Author | Owner |
|---|:--:|:--:|:--:|:--:|
| View flows & runs | ✓ | ✓ | ✓ | ✓ |
| Trigger / run flows | ✓ | ✓ | ✓ | ✓ |
| Act on approval gates | – | ✓ | ✓¹ | ✓ |
| Author flows / config / connections / targets | – | – | ✓ | ✓ |
| Write secrets | – | – | ✓ | ✓ |
| Manage users, roles, projects | – | – | – | ✓ |

¹ Whether Authors may also approve is **configurable** (default: yes). Some orgs
require separation of duties (author ≠ approver); a per-project toggle covers both.

Public trigger surfaces (`/hooks/*`, `/forms/*`, `/mcp`, and the public
`/approve` page when sign-in isn't required) stay **unauthenticated by design**
(path-secret / token), unaffected by RBAC.

## Identity model

- **User**: `{ id, email, name, passwordHash, createdAt, disabled }`. Passwords
  hashed with scrypt (`node:crypto`) — never stored plaintext.
- **Assignment**: `{ userId, projectId, role }`. No assignment in a project ⇒ no
  access to it. A user can be Author in project A and Consumer in project B.
- **Owner**: a global role (or `owner: true` flag) that manages users/projects and
  implicitly has every capability in every project.
- **Session**: a signed token `{ userId, iat, exp }` (reuses `signPayload`/
  `verifyPayload`), stored client-side as today. The server resolves
  `userId → user → per-project roles` per request. A server-side revocation set
  (by `userId`/token id) supports disable + logout-all.

Stored in the same document store as everything else (`db.users`, `db.roles`),
per-instance; no external dependency.

## Enforcement

- Middleware resolves the token → `req.user` (or 401). Disabled users are rejected.
- Routes declare a required capability and how to derive the project from the
  request: `requireCap('flow.write', req => projectOf(req))`.
- **Approvals**: `/api/approval` requires `approval.act` in the run's project and
  records `req.user` as the authoritative approver (the magic-link token still
  scopes *which* gate; the session decides *who*). This is the exact slot the
  0.5.14 endpoint left open.
- UI hiding is cosmetic; the server is the source of truth.

## Migration / bootstrap

- **No users defined ⇒ legacy mode**: fall back to the current shared-password
  login as a single implicit Owner. Existing deploys behave identically until
  someone opts in — zero forced migration.
- **Bootstrap the first Owner** via env (`STEPRAIL_ADMIN_EMAIL` +
  `STEPRAIL_ADMIN_PASSWORD`) or a first-run setup screen. Creating the first user
  disables shared-password mode.
- On first-user creation, assign **Owner** across all existing projects so nothing
  becomes inaccessible.

## UI

- **Team** screen (Owner only): list/create/disable users, set per-project roles.
- **Login**: email + password (extends the current gate).
- **Role-aware nav**: Consumers see Flows (run) + Reports; Approvers add Approvals
  (act) + run views; Authors get the full editor/secrets/config; Owner adds Team.
- "Signed in as `<name>`" + sign-out; the active project already exists.

## Audit

Generalize the approval decision log into an **audit log**:
`{ at, userId, projectId, action, target }` — covering approvals (already logged),
auth events (login, role change, user disable), and optionally authoring
mutations. Persisted like the approval log (outlives run pruning).

## Security

- scrypt password hashing; constant-time comparisons; login rate-limited (the
  limiter already exists).
- Session tokens signed + expiring; revocable on disable/logout-all.
- **Enforcement is always server-side**; the client never decides authorization.
- Roles are the *only* gate for authoring/secrets — no capability leaks through
  the public trigger paths (those remain path-secret, never RBAC-bypassing writes).

## Open decisions (need a call before build)

1. **Local accounts for v1, SSO later?** — Recommend local first; design admits OIDC.
2. **Per-project roles + global Owner?** — Recommended (matches the tenant model).
3. **Can Authors approve?** — Recommend a per-project separation-of-duties toggle,
   default Authors-can-approve.
4. **Consumers run scope** — any flow in their project (v1) vs only shared ones
   (later). Recommend any-in-project.
5. **User onboarding** — admin-set password vs emailed invite/reset link (could
   reuse the signed-link machinery). Recommend admin-set + optional reset link.

## Rollout phases

1. **Identity**: user accounts, session-as-user, bootstrap + legacy fallback
   (no enforcement yet — everyone effectively Owner).
2. **Roles**: per-project assignment model + Team UI.
3. **Enforcement**: capability middleware, rolled out endpoint-by-endpoint
   (approvals → secrets → authoring → run/trigger).
4. **Client**: role-aware nav and controls.
5. **Later**: full audit log, SSO/OIDC, separation-of-duties refinements.

Each phase is independently shippable and reversible; enforcement (phase 3) is the
one that changes behavior, so it lands last and can start in a warn-only mode.
