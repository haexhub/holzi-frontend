# Plan 20: Onboarding, Diagnostics, And Docs

Depends on: [03b](./03b-agent-runs-and-observability.md) (run history powers the
Recent Failures panel) and [19](./19-production-hardening.md).

## Goal

Make Holzi easier to set up, troubleshoot, and operate after deployment.

## Why

Hermes WebUI's maturity is not only features; it is also onboarding and
operational clarity. Holzi should provide the same confidence in a smaller,
project-specific way.

## Scope

Backend:

- Add diagnostics endpoint with redacted status:
  - database reachable
  - active LLM credential present
  - active messenger accounts
  - scheduler running
  - workspace roots valid
- Add bootstrap/check command if useful.

Frontend:

- Add first-run/onboarding empty state.
- Add Diagnostics page in Control Center.
- Add a "Recent Failures" panel on Diagnostics backed by
  `GET /api/runs?status=error` from Plan 03b. Each row links to a per-run
  detail view with the persisted error and trace.
- Add copyable environment hints without exposing secrets.

Docs:

- Update README quickstart.
- Add troubleshooting doc.
- Add model/provider setup doc.

Tests:

- Diagnostics endpoint redacts secrets.
- Frontend diagnostics rendering smoke test if feasible.

## Suggested Implementation

1. Backend endpoint: `GET /api/diagnostics`.
2. Return status objects with `ok`, `warning`, `error`, and short messages.
3. Frontend diagnostics page groups checks by area:
   - Auth
   - LLM
   - Messenger
   - Scheduler
   - Workspace
   - Deployment
4. On first run, guide user to:
   - add LLM credential
   - start chat
   - link messenger
5. Write docs from the exact current commands, not aspirational commands.

## Acceptance Criteria

- A new user can see what is missing before first chat.
- Diagnostics page helps identify broken LLM/messenger/setup state.
- No secrets are returned or rendered.
- README and troubleshooting docs match actual commands.

## Out Of Scope

- Full guided setup wizard.
- Automatic secret generation in UI.
- Remote telemetry.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/diagnostics.py`
  - `tests/test_api_diagnostics.py`
  - `README.md`
  - `docs/`
- Frontend:
  - `app/pages/settings/diagnostics.vue`
  - `app/components/chat/EmptyChatState.vue`
  - `README.md`
