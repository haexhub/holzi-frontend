# Plan 03b: Agent Runs And Observability

Depends on: [03](./03-chat-cancel-and-run-state.md).

## Goal

Persist every agent run with status, timing, and failure context so errors are
debuggable after the fact and structured logs correlate across components.

## Why

A 24/7 agent fails. Without persisted run records, debugging means scrolling
container logs. With them, a "Recent failures" panel is one query away and every
log line is correlated by `run_id`. This is also the natural place to make the
single-worker container invariant explicit.

## Scope

Backend:

- Add `agent_runs` table: `id` (run_id), `conversation_id`, `channel`, `model`,
  `started_at`, `finished_at`, `status`, `error_code`, `error_message`,
  `error_trace`, `input_tokens`, `output_tokens`.
- `status` enum: `running`, `success`, `cancelled`, `error`.
- The in-memory cancel registry from [Plan 03](./03-chat-cancel-and-run-state.md)
  becomes a thin index over this table; the table is the source of truth for
  history and the registry is a per-process accelerator for active runs.
- Structured stdout logs (JSON) with `run_id`, `conversation_id`, `channel`,
  `event`, `elapsed_ms`.
- `GET /api/runs?conversation_id=...&status=...&limit=...` for diagnostics.
- Optional behind a flag: `agent_run_events` table for full SSE replay/debug.

Frontend:

- The "Recent failures" panel itself lives in
  [Plan 20](./20-onboarding-diagnostics-docs.md); 03b only exposes the API.

Tests:

- Run row persists with correct status on success/cancel/error.
- Error rows include code, message, and trace.
- Listing endpoint filters by status and conversation and paginates.
- Cancel correctly transitions in-flight runs to `cancelled`.

## Single-Worker Invariant

Each agent runs in a dedicated container with a single worker. The in-memory
cancel event from Plan 03 is safe because there is exactly one process per
agent. Document this assumption in `src/hermes/agent.py` and gate any future
multi-worker mode behind a check that refuses to start.

## Acceptance Criteria

- Every chat run produces exactly one `agent_runs` row, regardless of channel.
- Error runs carry enough context to reproduce locally (model, prompt hash,
  trace).
- Logs are JSON and grep-friendly by `run_id`.
- Listing endpoint paginates and is auth-protected.

## Out Of Scope

- OpenTelemetry integration.
- Per-run trace view inside the chat UI.
- Prometheus metrics export.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/schema.py`
  - `src/hermes/repository/runs.py`
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `src/hermes/logging.py`
  - `tests/test_api_runs.py`
