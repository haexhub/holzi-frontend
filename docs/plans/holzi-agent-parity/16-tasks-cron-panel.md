# Plan 16: Tasks And Cron Panel

Depends on: [14](./14-control-center-shell.md). Scheduled tasks that execute
code must route through the sandbox runtime defined in
[11b](./11b-sandbox-runtime.md) — the scheduler thread lives in the agent
container and must not be killable by a misbehaving task.

## Goal

Manage scheduled and recurring agent tasks from the Web UI.

## Why

An always-on server agent should be able to do work later or repeatedly:
reminders, summaries, checks, syncs, and maintenance tasks. Users need to see
and control those tasks.

## Scope

Backend:

- Add task model if current reminders are too narrow.
- Add CRUD endpoints for scheduled tasks.
- Add pause/resume.
- Add run-now endpoint.
- Store minimal run history.

Frontend:

- Add `/settings/tasks`.
- List tasks.
- Create/edit/pause/delete tasks.
- Run task now.
- Show last run status.

Tests:

- Backend CRUD tests.
- Scheduler tests for due task execution.
- Frontend composable tests if extracted.

## Suggested Model

Fields:

- `id`
- `title`
- `prompt`
- `schedule` or `due_at`
- `timezone`
- `channel`
- `enabled`
- `last_run_at`
- `last_status`
- `created_at`
- `updated_at`

## Suggested Implementation

1. Keep existing reminders intact.
2. Introduce tasks as a separate concept if recurring work is needed.
3. Start with one-shot plus simple cron expression, or one-shot only if the
   session needs to stay smaller.
4. Add run history table only with minimal fields.
5. UI should make pause/resume obvious.

## Acceptance Criteria

- User can create a scheduled task.
- User can pause/resume/delete it.
- User can run it manually.
- Last run status is visible.
- Existing reminders still work.

## Out Of Scope

- Complex calendar UI.
- Multi-step workflows.
- Approval policies for scheduled tasks.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/scheduler.py`
  - `src/hermes/schema.py`
  - `src/hermes/routes/tasks.py`
  - `tests/test_scheduler.py`
  - `tests/test_api_tasks.py`
- Frontend:
  - `app/pages/settings/tasks.vue`
  - `app/composables/useTasks.ts`
