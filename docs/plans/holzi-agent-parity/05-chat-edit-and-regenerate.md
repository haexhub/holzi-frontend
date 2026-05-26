# Plan 05: Edit And Regenerate

Depends on: [04](./04-chat-retry-last-response.md) — reuses the
delete-then-rerun mechanic on a specific message instead of the last one.

## Goal

Allow editing a previous user message and regenerating the conversation from
that point.

## Why

Editing is essential for productive agent work. Users often need to correct one
instruction instead of starting a new chat or manually reconstructing context.

## Scope

Backend:

- Add endpoint for editing a user message and regenerating from it.
- Ensure later assistant/tool messages are removed or superseded.
- Keep conversation integrity: no orphaned tool results.

Frontend:

- Add Edit action to user messages.
- Provide inline edit mode or a compact modal.
- Warn that later messages will be regenerated.
- Stream the replacement answer.

Tests:

- Editing the last user message.
- Editing an earlier user message.
- Reject editing assistant/tool messages.
- Reject editing messages outside the selected conversation.

## Suggested Endpoint

`POST /api/conversations/{conversation_id}/messages/{message_id}/edit-and-regenerate`

Body:

```json
{
  "content": "new user text"
}
```

## Suggested Implementation

1. Add backend validation:
   - conversation exists
   - message exists
   - message role is `user`
   - message belongs to conversation
2. Update the user message content and timestamp or create a replacement message.
3. Delete/supersede all later messages in that conversation.
4. Start a new agent run using the edited transcript.
5. Frontend reloads canonical conversation after stream completion.

## Acceptance Criteria

- User messages have an Edit action.
- Editing a message clearly communicates that later turns will be regenerated.
- After completion, the transcript contains the edited user text and a new
  assistant answer.
- Tool messages from the previous branch are gone or marked superseded.

## Out Of Scope

- Branch/fork UI.
- Version history of edited messages.
- Collaborative editing.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/components/chat/ChatMessage.vue`
  - `app/pages/index.vue`
  - `app/composables/useChatStream.ts`
