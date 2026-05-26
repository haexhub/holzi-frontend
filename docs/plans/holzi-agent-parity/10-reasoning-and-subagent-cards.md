# Plan 10: Reasoning And Subagent Cards

Depends on: [08](./08-tool-call-cards.md) (event taxonomy).

## Goal

Represent reasoning, thinking, and subagent activity as optional structured UI
cards.

## Why

Some providers and agent modes expose intermediate thinking or subagent work.
This is useful for debugging and trust, but it should not dominate the normal
chat view.

## Scope

Backend:

- Define optional event types:
  - `reasoning`
  - `subagent_start`
  - `subagent_text`
  - `subagent_done`
- Persist only the parts that should survive reload.
- Make provider support optional.

Frontend:

- Add collapsible `ReasoningCard.vue`.
- Add `SubagentCard.vue`.
- Add user preference for showing reasoning by default.

Tests:

- Parser tests for new SSE events.
- Frontend rendering tests for collapsed/expanded cards.

## Suggested Implementation

1. Add generic stream event handling so unknown events do not break chat.
2. Map provider-specific reasoning into Holzi event shapes.
3. Keep cards collapsed by default.
4. Store a preference in local storage first; backend preference can come later.

## Acceptance Criteria

- Reasoning events render in a collapsible card.
- Subagent events render as grouped activity.
- If provider emits no reasoning, normal chat is unchanged.
- Unknown future events are ignored or displayed as debug only.

## Out Of Scope

- Full provider-specific reasoning normalization.
- Multi-agent orchestration.
- Public sharing of reasoning.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `tests/test_agent_streaming.py`
- Frontend:
  - `app/composables/useChatStream.ts`
  - `app/components/chat/ReasoningCard.vue`
  - `app/components/chat/SubagentCard.vue`
  - `app/components/chat/ChatMessage.vue`
