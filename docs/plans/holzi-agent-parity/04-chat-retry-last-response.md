# Plan 04: Retry Last Response

Depends on: [03](./03-chat-cancel-and-run-state.md).

## Goal

Let users regenerate the latest assistant response in a conversation.

## Why

Retry is one of the highest-value chat controls. It helps with provider flakiness,
weak answers, tool failures, and model nondeterminism without forcing the user to
copy/paste the previous prompt.

## Scope

Backend:

- Add `POST /api/conversations/{id}/retry`.
- Find the last user message in the conversation.
- Remove or supersede assistant/tool turns after that user message.
- Re-run the agent using the remaining conversation context.
- Stream the new response with the same SSE semantics as `/api/chat`.

Frontend:

- Add Retry button to the latest assistant message.
- Reuse stream rendering and loading state.
- Disable retry while another run is active.

Tests:

- Retry simple conversation.
- Retry conversation with tool turns after last user message.
- Reject retry when no user message exists.
- Ensure retry cannot target non-web conversation unless explicitly allowed.

## Suggested Implementation

1. Add repository helper to fetch the last user message.
2. Decide the persistence strategy:
   - simplest: delete all messages after the last user message
   - later: keep old messages with `superseded_at`
3. Reuse the existing agent runner path so retry is not a separate code path.
4. In the frontend, expose `retryLastResponse(conversationId)`.
5. Use the same streaming state as normal send.

## Acceptance Criteria

- A Retry action appears on the last assistant response.
- Clicking Retry replaces the previous assistant/tool tail with a new run.
- Conversation list updates after retry.
- Retry failures show the same friendly error handling as normal chat.

## Out Of Scope

- Retry arbitrary older messages.
- Forked conversations.
- Edit-and-regenerate.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_api_chat.py`
  - `tests/test_api_conversations.py`
- Frontend:
  - `app/pages/index.vue`
  - `app/components/chat/ChatMessage.vue`
  - `app/composables/useChatStream.ts`
