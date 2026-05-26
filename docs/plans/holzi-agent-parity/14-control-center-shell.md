# Plan 14: Control Center Shell

## Goal

Create a coherent Control Center for operating Holzi.

## Why

Settings will grow beyond LLM credentials and messenger accounts. A stable
Control Center structure prevents a pile-up of unrelated settings pages.

## Scope

Frontend:

- Rework `/settings` into a Control Center shell.
- Preserve existing LLM and Messenger pages.
- Add placeholder routes for:
  - Preferences
  - Memory
  - Tasks
  - Skills/Tools
  - Workspaces
  - Diagnostics
- Add responsive navigation.

Backend:

- No backend changes required unless a basic preferences endpoint is included.

Tests:

- Route rendering smoke tests if project has route test pattern.
- At minimum run typecheck.

## Suggested Implementation

1. Keep existing `/settings/llm` and `/settings/messenger`.
2. Add a settings navigation model in one place.
3. Use route-based tabs/sidebar so deep links work.
4. Add empty placeholder pages with concise copy and no fake functionality.
5. Avoid visual over-design; this is an operational UI.

## Acceptance Criteria

- Existing LLM and Messenger settings still work.
- New Control Center navigation gives each future area a clear home.
- `/settings` redirects to a sensible default.
- Layout works on mobile and desktop.

## Out Of Scope

- Implementing all panels.
- Backend preferences.
- Auth changes.

## Files Likely Touched

- Frontend:
  - `app/pages/settings.vue`
  - `app/pages/settings/index.vue`
  - `app/pages/settings/llm.vue`
  - `app/pages/settings/messenger.vue`
  - new placeholder files under `app/pages/settings/`
