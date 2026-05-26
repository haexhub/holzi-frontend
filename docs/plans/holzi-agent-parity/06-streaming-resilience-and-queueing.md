# Plan 06: Streaming Resilience And Queueing

Depends on: [03](./03-chat-cancel-and-run-state.md) (stream state machine).

## Goal

Make chat feel robust during slow/mobile networks and allow users to queue the
next message while a turn is still streaming.

## Why

Holzi is intended to be used from everywhere. Mobile and remote connections will
drop. Users also naturally type follow-ups while the agent is still answering.

## Scope

Frontend-first session:

- Track stream state as:
  - `idle`
  - `streaming`
  - `reconnecting`
  - `failed`
  - `cancelled`
- Keep composer usable while streaming.
- If user submits while streaming, place the message in a visible local queue.
- Automatically send the queued message after `done`.
- Show explicit failure state if the stream drops.

Backend:

- No full resume protocol in this session.
- Ensure SSE errors are terminal and clear.

Tests:

- `useChatStream` test for reader failure.
- UI/composable test for queued send order if queue logic is extracted.

## Suggested Implementation

1. Refactor `app/pages/index.vue` chat state into clearer state variables or a
   small composable.
2. Change composer disabling:
   - Stop button remains active for current stream.
   - Send can enqueue instead of being disabled.
3. Represent queued messages in the transcript as pending user messages.
4. On stream `done`, shift one queued message and send it.
5. On stream failure, keep queued messages unsent and visible.

## Acceptance Criteria

- The user can type and submit while Holzi is responding.
- Queued message is visible before it is sent.
- Queued message sends automatically after the current response finishes.
- A dropped stream does not silently clear queued messages.
- Failure state gives the user an obvious retry path.

## Out Of Scope

- True server-side queue.
- Resuming a partial SSE stream from event ID.
- Queueing for Signal/Telegram.

## Files Likely Touched

- Frontend:
  - `app/pages/index.vue`
  - `app/components/chat/ChatComposer.vue`
  - `app/composables/useChatStream.ts`
  - `tests/composables/useChatStream.test.ts`
