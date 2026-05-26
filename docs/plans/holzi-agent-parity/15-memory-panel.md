# Plan 15: Memory Panel

Depends on: [14](./14-control-center-shell.md).

## Goal

Make Holzi's memory visible and editable.

## Why

A personal agent that "knows things" must also let the user inspect and correct
that knowledge. This keeps trust high and prevents stale memory from becoming a
hidden liability.

## Scope

Backend:

- Improve notes/memory search API if needed.
- Add update support to the frontend-facing memory path.
- Optionally distinguish memory types:
  - notes
  - user facts
  - project facts

Frontend:

- Add `/settings/memory`.
- Search memory.
- Create/edit/delete memory entries.
- Show tags and timestamps.

Tests:

- Backend memory CRUD/search tests if APIs change.
- Frontend tests for memory composable if extracted.

## Suggested Implementation

1. Start with existing Notes as the first memory surface.
2. Add search query to notes endpoint if not already exposed.
3. Create `useMemory` or `useNotes` composable.
4. Build Memory page with:
   - search
   - list
   - edit drawer/modal or inline editor
   - delete confirmation
5. Keep the right-side Notes panel simple; advanced management lives in Control
   Center.

## Acceptance Criteria

- User can search memory.
- User can edit an existing note/memory entry.
- User can delete stale memory.
- User can create new memory from Control Center.
- Agent-facing notes remain compatible.

## Out Of Scope

- Vector memory.
- Automatic memory extraction UI.
- Memory approval workflow.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/notes.py`
  - `tests/test_api_notes.py`
- Frontend:
  - `app/pages/settings/memory.vue`
  - `app/composables/useMemory.ts`
  - `app/components/panels/NotesPanel.vue`
