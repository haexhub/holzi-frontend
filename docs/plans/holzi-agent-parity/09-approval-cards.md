# Plan 09: Approval Cards

Depends on: [08](./08-tool-call-cards.md) (event taxonomy and card UI pattern).

## Goal

Pause dangerous actions and ask the user for explicit approval from the Web UI.

## Why

As Holzi gains workspace and shell capabilities, safety needs to be built into
the agent loop. Approval cards let the agent remain powerful without silently
performing destructive operations.

## Scope

Backend:

- Define an approval request model.
- Add approval registry or persisted approval table.
- Add endpoint to approve/deny pending actions.
- Teach risky tools to return `approval_required` before execution.
- Resume or fail the agent turn after user decision.

Frontend:

- Add `ApprovalCard.vue`.
- Show requested command/action, risk reason, and arguments.
- Buttons:
  - Allow once
  - Deny
- Stream remains in waiting state while approval is pending.

Tests:

- Backend test for approval-required path.
- Backend test for deny path.
- Frontend test for approval card actions.

## Suggested Endpoint

- `POST /api/approvals/{approval_id}`

Body:

```json
{
  "decision": "allow_once"
}
```

or

```json
{
  "decision": "deny",
  "reason": "Not now"
}
```

## Stream Lifetime And Reconnect

Approvals can take minutes. Idle proxies (Traefik, mobile carriers) close
silent SSE connections quickly, so the stream must actively stay alive and
must be safe to re-attach to:

- Send a comment heartbeat `: ping\n\n` every 15 s while waiting.
- Persist run state via [Plan 03b](./03b-agent-runs-and-observability.md) so a
  reconnect can locate the run by `run_id`.
- Expose `GET /api/runs/{run_id}/stream` to re-attach to an in-flight run; on
  reconnect the server replays the last known status plus pending approval
  events.
- Approval decisions arrive over a separate `POST /api/approvals/{approval_id}`,
  not over the stream. The server resolves an `asyncio.Event`/`Future` which
  the agent runner is awaiting; this works even if the original client has
  reconnected to a different SSE stream.

## Suggested Implementation

1. Start with one approval-aware tool class, ideally shell or destructive file
   operation.
2. Emit SSE event `approval_required` using the envelope from Plan 08.
3. Keep the HTTP stream open with the heartbeat above.
4. Approval endpoint resolves an async event/future in the backend run
   registry; the registry entry is per-process and safe because of the
   single-worker invariant documented in Plan 03b.
5. Agent continues after allow or receives a denied tool result after deny.

## Acceptance Criteria

- Risky action pauses and shows an approval card.
- Allow executes the pending action once.
- Deny returns a denied result to the agent.
- The UI does not allow duplicate approval submissions.
- Expired/unknown approval IDs are handled cleanly.

## Out Of Scope

- Remembered approvals.
- Policy engine.
- Multi-user approval.
- Messenger-based approvals.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/agent.py`
  - `src/hermes/tool_catalog.py`
  - `src/hermes/routes/api.py`
  - `tests/test_api_chat.py`
  - `tests/test_tools_*`
- Frontend:
  - `app/components/chat/ApprovalCard.vue`
  - `app/composables/useChatStream.ts`
  - `app/pages/index.vue`
