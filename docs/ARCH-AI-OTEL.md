# AI orchestration (MCP) and OpenTelemetry tracing

## MCP, both directions

**Connection type `mcp`.** A named connection whose secret is either a stdio
command line (`npx -y @modelcontextprotocol/server-filesystem /data`) or an
HTTP endpoint (`https://host/mcp`). `server/mcp.mjs` is a minimal MCP client:
JSON-RPC 2.0 over newline-delimited stdio or plain HTTP POST (SSE responses
parsed), `initialize` → `tools/list` / `tools/call`.

**MCP as a step (`ai.mcptool`).** Pick an MCP connection, name a tool, pass
arguments as JSON (tokens resolve first). The step returns the tool result —
external capability without writing a connector.

**Agentic loop (`ai.agent`).** With an MCP connection attached, the agent step
runs a real tool-use loop: Claude receives the server's tools, decides which
to call, newflow executes them via MCP, feeds results back, and iterates until
the model stops or `maxSteps` is hit. Output includes the transcript of tool
calls. Without an MCP connection it stays a single reasoning call.

**MCP as a trigger (`trigger.mcp`).** newflow is itself an MCP server at
`POST /mcp` (stateless streamable-HTTP JSON-RPC). Every *active* flow whose
first step is an MCP trigger is listed as a tool: the trigger's field-builder
inputs become the tool's JSON schema, `tools/call` starts a queue run with the
arguments as trigger payload, waits (bounded) for completion, and returns the
final step's output. Point Claude Code at `http://oracle.local:8452/mcp` and
flows become callable tools. Point an *agent step* at it and flows orchestrate
flows.

## OpenTelemetry tracing

Every run is a trace (32-hex `traceId` on the run), every step a span
(16-hex ids, root span for the run). Spans carry attributes
(`newflow.tool`, `newflow.step_id`, `newflow.attempts`, `newflow.trigger`),
retries appear as span events, failures set span status ERROR with the
plain-language message. `data.http` sends a W3C `traceparent` header so
downstream services join the same trace.

- `GET /api/runs/:id/trace` → internal shape for the viewer
- `GET /api/runs/:id/trace?format=otlp` → standard OTLP/JSON (`resourceSpans`)
- Settings → "OTLP endpoint": when set, each finished run POSTs its spans to
  `<endpoint>/v1/traces` (Jaeger, Tempo, Grafana Cloud, any collector).

**Viewer.** The run drawer's Trace button opens a waterfall: one bar per span
on the run's timeline, status-colored, retries ticked as events; clicking a
span shows its attributes. Enough to answer "where did the time go and what
failed" without leaving the editor.
