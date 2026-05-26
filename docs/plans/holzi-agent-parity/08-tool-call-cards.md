# Plan 08: Tool Call Cards + Event Taxonomy

Depends on: [07](./07-chat-rendering-polish.md) (rendering surface). Establishes
the shared SSE event envelope used by Plans 09 and 10.

## Goal

Render tool calls as structured cards instead of plain `tool` text bubbles.

## Why

Tool use is where the agent becomes more than a chatbot. Users need to see what
Holzi did, with which arguments, whether it succeeded, and what result came
back.

## Scope

Backend:

- Add structured tool call metadata to persisted messages or stream events.
- Distinguish at least:
  - tool name
  - call ID
  - arguments
  - status
  - result
  - error
- Keep backward compatibility with existing `role: "tool"` messages.

Frontend:

- Add `ToolCallCard.vue`.
- Render collapsed summary by default.
- Expand to show args/result/error.
- Use status styling: running/success/error.

Tests:

- Backend test for persisted tool call metadata.
- Frontend rendering tests for success and error cards.

## Event Taxonomy

All SSE events share one envelope and live in a single source of truth at
`src/hermes/events.py` (Pydantic). OpenAPI generates the matching TS types.

Envelope:

```json
{
  "event": "tool_call",
  "version": 1,
  "data": { "...": "..." }
}
```

Rules:

- Unknown `event` values are ignored by clients (forward compatibility).
- Adding new optional fields to `data` does **not** bump `version`.
- Removing fields or changing semantics bumps `version`.
- The Pydantic models are the only place that defines event shapes; do not
  hand-write parallel structures in route handlers or frontend code.

Initial event types introduced here:

```json
{
  "event": "tool_call",
  "version": 1,
  "data": {
    "call_id": "call_123",
    "name": "notes.find",
    "arguments": { "query": "project status" },
    "status": "running"
  }
}
```

```json
{
  "event": "tool_result",
  "version": 1,
  "data": {
    "call_id": "call_123",
    "status": "success",
    "result": "..."
  }
}
```

Tests for the taxonomy:

- Parser ignores an unknown event without breaking the chat.
- A persisted conversation can be reconstructed by replaying its event stream.

## Suggested Implementation

1. Inspect how Holzi currently stores tool turns.
2. Add a JSON metadata column only if existing schema cannot represent tool
   calls safely.
3. Emit tool call start/result events during streaming.
4. Frontend stores active tool cards while streaming.
5. After stream completion, reload canonical conversation and render persisted
   cards.

## Acceptance Criteria

- Tool calls are visible as cards during streaming.
- Completed conversations show the same tool cards after reload.
- Long outputs are collapsed and do not break the layout.
- Tool errors are clearly visible.

## Out Of Scope

- Approval flow.
- Shell-specific safety classification.
- Subagent cards.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `src/hermes/schema.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_agent_streaming.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/components/chat/ChatMessage.vue`
  - `app/components/chat/ToolCallCard.vue`
  - `app/composables/useChatStream.ts`
