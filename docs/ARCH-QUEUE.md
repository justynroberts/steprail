# Queued event architecture for real job execution

**Status**: design proposal (v0.1 executes simulated runs in the browser). This is the plan for making runs real without giving up the core promise: *simpler than n8n — a teenager could run this.*

## Constraints that shape the design

1. **One process, zero brokers.** No Redis, no RabbitMQ, no Postgres requirement. The queue is a table in a single SQLite file (`data/newflow.db`). If newflow ever needs to scale past one box, the enqueue/dequeue interface stays the same and the backend swaps — but that day is not designed for up front.
2. **Everything is an event.** A run isn't a function call that must survive from start to finish; it's a chain of small events, each processed independently. That's what makes waits, approvals, retries, and restarts trivial instead of clever.
3. **The tree stays the truth.** The flow tree (portable JSON) is the program; the queue only records *where execution is* in that tree, using the same `SlotPath`-style addressing the editor already uses.

## The one table

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,        -- groups events into a run
  flow_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- run.start | step.run | step.done | step.failed | run.done
  address TEXT,                -- path to the step in the tree (hops + index)
  payload TEXT,                -- JSON: resolved inputs or outputs
  state TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | waiting
  not_before INTEGER,          -- ms epoch; enables wait/retry/schedule without timers
  attempts INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
);
```

A **worker loop** (same Node process as the API, `setInterval` ~500ms) does:

```
pick oldest event WHERE state='queued' AND (not_before IS NULL OR not_before <= now) LIMIT 1
→ mark running → execute → append follow-up events → mark done
```

Single-writer SQLite means no locking ceremony. Crash mid-step? On boot, `running` events older than a timeout flip back to `queued`. Nothing is lost because every hop is persisted before it's executed.

## How flow semantics map to events

- **Run**: `run.start` → enqueue `step.run` for step 0. Each `step.done` enqueues `step.run` for the next index in its lane. Last step in the root lane → `run.done`.
- **Branch lanes**: `step.done` on a branching step enqueues one `step.run` per lane (fan-out). A lane-counter on the run (or a `merge.wait` event that re-queues itself until all lanes report) implements fan-in. Lanes are just parallel chains of events — no special executor.
- **Wait**: emit `step.done` with `not_before = now + duration`. The worker skips it until due. Zero timers held in memory; survives restarts by construction.
- **Approval**: emit an event with `state='waiting'`. The API exposes `POST /api/approvals/:id/approve`, which flips it to `queued`. The run resumes exactly where it stopped — hours or days later.
- **Schedule trigger**: the friendly schedule (already JSON: `{"freq":"daily","time":"19:00"}`) compiles to the next-due timestamp; a `run.start` event sits in the queue with `not_before` set. When it fires, it enqueues the next occurrence. Cron never runs as a daemon — it's just the next event in the same table.
- **Webhook trigger**: `POST /hooks/:path` inserts `run.start` with the request body as payload and returns 202 + `run_id` immediately. Bursts don't spike workers; they deepen the queue.
- **Retries**: `step.failed` with `attempts < max` re-enqueues itself with exponential `not_before`. The plain-language error UX stays: the final failure is stored on the event and surfaces on the step card exactly like today.

## What the UI gains for free

The run drawer stops being a simulation view and becomes a *live query* (`GET /api/runs/:id` or SSE): every event row is a timeline entry, every payload is a data pill. Because outputs persist per step, token resolution (`{{Step.field}}`, `{{var.*}}`, `{{system.*}}`) uses the recorded payloads — identical semantics to today's `interpolateWith`, just reading from the table instead of memory. Test-step stays client-side and instant.

## Why this is simpler than n8n

n8n runs a worker fleet, a queue mode with Redis, execution modes (regular/queue/own-process), and a separate binary for scaling. Here there is **one process, one file, one table, one loop** — and every advanced behavior (parallelism, waits, human approval, retries, cron) falls out of two columns: `state` and `not_before`. The teenager test: `docker compose up`, and the only mental model needed is "steps become rows; rows get done."

## Incremental path

1. `runs` + `events` tables, worker loop, engine moved server-side behind `POST /api/runs` (simulated executors unchanged — same `sample()` outputs, now durable).
2. Live run drawer via SSE; approvals API + "Approve" button on the waiting card.
3. Real executors per tool (HTTP first, then Slack/email/postgres), each a small async function with the same signature as `sample()`.
4. Schedule + webhook triggers armed server-side (flows with a trigger get a standing `not_before` row / a hook route).
