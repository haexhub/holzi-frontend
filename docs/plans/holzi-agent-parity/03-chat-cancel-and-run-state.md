# Plan 03: Chat Cancel And Run State

Depends on: none. Introduces `run_id`, which is later persisted by
[Plan 03b](./03b-agent-runs-and-observability.md).

## Goal

Allow users to stop a running agent turn from the Web UI.

## Why

Long-running agent turns need user control. Without cancel, a bad prompt, slow
provider, or looping tool call forces the user to wait or reload the page.

## Scope

Backend:

- Introduce a run identifier for each `/api/chat` request.
- Track active web runs in process memory. Safe because each agent runs in a
  dedicated container with a single worker; document this invariant in
  `src/hermes/agent.py` and refuse to start under a multi-worker config.
- Add `POST /api/chat/runs/{run_id}/cancel`.
- Ensure agent streaming checks cancellation between model/tool steps.
- Emit a clear terminal SSE event for cancellation.

Frontend:

- Store `run_id` from the stream.
- Replace disabled composer-only state with a visible Stop action.
- On Stop, call the cancel endpoint and render the turn as cancelled.

Tests:

- Backend test for cancelling an active stream.
- Backend test that cancelling an unknown run returns a safe response.
- Frontend test for `useChatStream` parsing the run event and cancel event.

## Suggested SSE Events

- `run`: `{ "run_id": "..." }`
- `session`: `{ "conversation_id": 123 }`
- `text`: `{ "content": "..." }`
- `cancelled`: `{}`
- `done`: `{}`
- `error`: `{ "code": "...", "status_code": 500, "message": "..." }`

## Suggested Implementation

1. Create a small run registry on `app.state`, mapping run IDs to cancellation
   flags/events.
2. Emit `run` before the first model call.
3. Pass a cancellation checker into the agent runner.
4. Check cancellation:
   - before upstream calls
   - after upstream chunks
   - before tool execution
   - after tool execution
5. Cleanup the run registry in `finally`.
6. Add frontend `cancelChatRun(runId)`.

## Acceptance Criteria

- The Web UI shows a Stop button during streaming.
- Clicking Stop ends the active stream without a browser reload.
- The UI does not append a fake completed assistant answer after cancel.
- The backend does not leave the run registered after completion/cancel/error.

## Out Of Scope

- Retry.
- Queueing.
- Server-side persistent job queue.
- Cancelling Signal/Telegram turns.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/agent.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/composables/useChatStream.ts`
  - `app/pages/index.vue`
  - `app/components/chat/ChatComposer.vue`
  - `tests/composables/useChatStream.test.ts`
