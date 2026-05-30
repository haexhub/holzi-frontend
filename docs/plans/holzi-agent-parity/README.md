# Holzi Agent Parity Roadmap

This folder contains session-sized implementation plans for growing Holzi into
the central personal agent hub:

- one always-on agent core on the server
- many clients: Web UI, Signal, Telegram, Cline/Roo, later haex-vault and MCPs
- shared memory, tools, conversations, credentials, and operational controls

The goal is not to clone `nesquena/hermes-webui` line by line. The goal is to
bring the same class of capabilities into Holzi in a way that fits Holzi's
backend-first architecture.

## Architecture Principle

Holzi is the agent core.

`holzi-frontend`, Signal, Telegram, Cline/Roo, and future integrations are
clients. New capabilities should live in the backend whenever they affect agent
state, memory, tools, conversations, approvals, workspaces, or model routing.
The frontend should make those capabilities visible and pleasant to operate.

## Naming

- **Holzi** is the name of the agent and of the whole system as observed from
  the outside.
- The backend repository historically uses the package name `hermes`
  (`src/hermes/...`). New code should keep that import path until a coordinated
  rename happens; user-facing strings always say "Holzi".

## Deployment Model

- One agent runs per container, single worker, single user. The agent
  container is the always-on, lightweight surface.
- Multi-user scaling is achieved by running more agent containers, not more
  workers per container.
- Plans that rely on in-memory state (cancel registry, approval futures,
  SSE buffers) assume this invariant. Plan 03b documents it explicitly.
- Any operation that runs code, executes shell, or performs unbounded file
  writes lives in a sandbox container, not the agent. See Plan 11b for
  topology (workspace sandboxes + ephemeral execution sandboxes). The agent
  itself stays unkillable.

## Status

Completed:

- [01](./01-conversation-lifecycle.md) — conversation lifecycle (2026-05-25)
- [01b](./01b-conversation-retention-and-bookmarks.md) — retention + bookmarks (2026-05-26)
- [02](./02-conversation-search-organization.md) — search and organization (2026-05-26; follow-up [Holzi#33](https://github.com/haexhub/Holzi/pull/33) merged)
- [03](./03-chat-cancel-and-run-state.md) — chat cancel and run state (2026-05-26)
- [03b](./03b-agent-runs-and-observability.md) — agent runs and observability (2026-05-26)
- [04](./04-chat-retry-last-response.md) — chat retry last response (2026-05-26)
- [05](./05-chat-edit-and-regenerate.md) — chat edit and regenerate (2026-05-27)
- [06](./06-streaming-resilience-and-queueing.md) — streaming resilience and queued sends (2026-05-27; frontend-only [holzi-frontend#29](https://github.com/haexhub/holzi-frontend/pull/29) merged)
- [07](./07-chat-rendering-polish.md) — chat rendering polish (2026-05-27; frontend-only [holzi-frontend#30](https://github.com/haexhub/holzi-frontend/pull/30) merged)
- [08](./08-tool-call-cards.md) — tool call cards + event taxonomy (2026-05-27; cross-repo [Holzi#38](https://github.com/haexhub/Holzi/pull/38) + [holzi-frontend#31](https://github.com/haexhub/holzi-frontend/pull/31) merged)
- [09](./09-approval-cards.md) — approvals and safety cards (2026-05-27; cross-repo [Holzi#39](https://github.com/haexhub/Holzi/pull/39) + [holzi-frontend#32](https://github.com/haexhub/holzi-frontend/pull/32) merged)
- [10](./10-reasoning-and-subagent-cards.md) — reasoning and subagent cards (2026-05-27; cross-repo [Holzi#40](https://github.com/haexhub/Holzi/pull/40) + [holzi-frontend#34](https://github.com/haexhub/holzi-frontend/pull/34) merged). Reasoning end-to-end; subagent events are the wire contract + cards only (no orchestrator yet).
- [11](./11-attachments.md) — attachments (2026-05-27; cross-repo [Holzi#42](https://github.com/haexhub/Holzi/pull/42) + [holzi-frontend#36](https://github.com/haexhub/holzi-frontend/pull/36) merged). Text/code/log inlined into agent context; images + PDF stored as metadata-only (no provider image inputs yet). Added `POST /api/conversations` so the first message of a fresh chat can carry attachments.
- [11b-a](./11b-a-sandbox-spine.md) — sandbox spine: lifecycle + exec + limits + network isolation (2026-05-28; cross-repo [Holzi#43](https://github.com/haexhub/Holzi/pull/43) + [holzi-frontend#38](https://github.com/haexhub/holzi-frontend/pull/38) merged). Rootless Podman, `SandboxManager` + `PodmanSandboxBackend`, sandboxes run with `NetworkMode none` so the isolation criterion holds against real Podman. Verified live: 3/3 integration tests green (exec demux, kill resilience, network unreachability). Host prerequisites (subuid/subgid, cpu cgroup delegation, podman ≥4.x) encoded in the ansible `podman_debian` role.
- [11b-b](./11b-sandbox-runtime.md) — sandbox runtime remainder: file API + health watcher + `sandbox_crashed` event + restart endpoint + in-chat crash card (2026-05-28; cross-repo [Holzi#44](https://github.com/haexhub/Holzi/pull/44) + [holzi-frontend#40](https://github.com/haexhub/holzi-frontend/pull/40) merged). `read_file`/`write_file` on the `SandboxBackend` Protocol (Podman uses `/containers/{id}/archive` tar-wrapping with streaming + 10 MiB cap); `git` stayed as plain `exec(["git", ...])`. `SandboxManager` health watcher (surface-only, never auto-restarts) plus dedupe by (workspace_id, sandbox_id). `sandbox_crashed` SSE event in the existing envelope; the chat stream subscribes a per-request crash handler. `GET /api/workspaces/{id}/sandbox` (returns `absent` when no handle is cached) and `POST .../restart`. Frontend `SandboxCrashCard.vue` is rendered in `pages/index.vue` as a conversation-scoped banner; **Workspace badge → Plan 12, persistent crash log → Plan 20**.
- [12](./12-workspace-browser-readonly.md) — read-only workspace browser (2026-05-29; cross-repo [Holzi#45](https://github.com/haexhub/Holzi/pull/45) + [holzi-frontend#42](https://github.com/haexhub/holzi-frontend/pull/42) merged). New `list_dir` on `SandboxBackend` (Podman uses `find -mindepth 1 -maxdepth 1 -printf …` with an `sh -c` guard mapping missing/not-a-dir to exit codes 44/45). Three endpoints under `/api/workspace/{roots,tree,file}` route through Plan 11b-b's sandbox-mounted `/workspace` volume — never the host filesystem; `HERMES_WORKSPACE_ROOTS` configures the visible workspace_ids. Preview classification: text (256 KiB cap with truncation flag), markdown, image (2 MiB base64 cap, extension-only, no magic-bytes), binary metadata-only; SVG previews as XML source not as an opaque image. `SandboxNotRunning` surfaces as 503 on both routes so the existing `sandbox_crashed` UI applies. Frontend `WorkspacePanel.vue` mounted as the 4th right-panel tab with breadcrumb, dir listing, refresh, stale-response guard, and `aria-live` preview region.
- [13](./13-workspace-write-git.md) — workspace write + git status (2026-05-29; cross-repo [Holzi#46](https://github.com/haexhub/Holzi/pull/46) + [holzi-frontend#44](https://github.com/haexhub/holzi-frontend/pull/44) merged). `POST/PUT/DELETE /api/workspace/file`, `POST /api/workspace/rename`, and `GET /api/workspace/git` — all mutations route through the workspace sandbox (`write_file` + `exec(["mv"...])` / `exec(["rm"...])`) and are followed by `git add -A` + `git -c user.name/email=Holzi commit -m "user[conv-N]: <action> <path>"` when the root is a git repo; non-repo roots return `committed: false` and the write still goes through. `GET /file` now returns the on-disk `sha256` so writers pass it back as `base_sha`; mismatch → 409 (Conflict Card UI deferred to bind-mount mode). NUL bytes in `content` → 400 (binary-as-text guard). `_stat_entry` normalises missing parent / "not a directory" parents into 404/400 instead of raw `SandboxError`; `_git_commit` swallows `SandboxError` so a sandbox crash mid-commit can't 500 after a successful write. Frontend `WorkspacePanel.vue` grows edit mode (textarea + Save with `base_sha` round-trip, neutral `saveNotice` for non-git success vs destructive `saveError`), `Neue Datei` inline create form, rename + delete behind `window.prompt`/`confirm`, branch + dirty/clean badge. Writes are gated by an active chat (`conversationId`) so every commit message has an honest author tag; losing the conversation mid-edit drops the draft. `FakeSandboxBackend.script_exec` became a FIFO queue and gained `recorded_execs` so tests can assert the git commit argv.
- [14](./14-control-center-shell.md) — Control Center shell (2026-05-29; frontend-only [holzi-frontend#46](https://github.com/haexhub/holzi-frontend/pull/46) merged). `/settings` reworked into a Control Center with a single nav model in `app/lib/settingsNav.ts` consumed by both the desktop sidebar (sticky, 208 px wide) and mobile top-tabs in `pages/settings.vue`. Six placeholder routes (`preferences`, `memory`, `tasks`, `skills`, `workspaces`, `diagnostics`) all render the shared `components/settings/PlaceholderSection.vue` which looks itself up in the nav model by `route.path`. Shipped sections (`llm`, `messenger`) keep their existing content untouched; placeholders carry an `upcoming` hint and an empty-state card with no fake functionality. `/settings` still redirects to `/settings/llm`. Future plans (15 memory, 16 tasks, 20 diagnostics) just drop the `upcoming` hint and add real content.
- [15](./15-memory-panel.md) — memory panel (2026-05-29; cross-repo [Holzi#48](https://github.com/haexhub/Holzi/pull/48) + [holzi-frontend#48](https://github.com/haexhub/holzi-frontend/pull/48) merged). Adds optional `?q=` to `GET /api/notes` backed by the existing FTS5 helper with a small `_fts5_query` sanitiser (whitespace-split, alnum-only tokens, quoted phrases) so the search box never leaks FTS5 operator syntax; whitespace-only `q` falls through to `list_all` (review fix, matches CodeRabbit's flag). Replaces the `/settings/memory` placeholder with a **Hermes WebUI-style two-pane layout** — left sidebar with "Personal memory" header + `+` button + search + note list (key, markdown preview, tag chips, selected-row highlight); right detail view flips between empty / read (full markdown via `RenderedMarkdown`) / edit modes with Edit/Trash and Cancel/Save header buttons mirroring Hermes WebUI exactly. Stale-selection-after-filter guard (both inside `load()` and `cancelEdit()`) keeps the detail pane in sync with the visible list. Verified live via `make up-local-full` + Playwright. Right-side rail in `pages/index.vue` lost the **Todos + Reminders tabs** (per user request "die todos, reminder bar kann gerne weg") — only Notes + Workspace remain; `TodosPanel.vue` + `RemindersPanel.vue` and their type aliases are deleted, backend endpoints stay.
- [16](./16-tasks-cron-panel.md) — tasks and cron panel (2026-05-29; cross-repo [Holzi#49](https://github.com/haexhub/Holzi/pull/49) + [holzi-frontend#51](https://github.com/haexhub/holzi-frontend/pull/51) merged). **Scope deviation from the plan file**: after confirming with the user that `reminders` + `todos` had no UI left after Plan 15 and only existed as agent tools, both were dropped entirely in favour of a single `agent_tasks` concept. New `agent_tasks` table carries one-shot (`due_at`) and recurring (5-field cron + IANA `timezone`) jobs; recurring rows persist both `schedule` (rule) and a materialised `due_at` (cached next firing) so the scheduler's hot-path query stays index-friendly. `AgentTaskScheduler` replaces `ReminderScheduler`, fires due rows via fresh `channel="task"` conversations through `run_agent` with `track_run(agent_task_id=...)`; tool calls inside route through `SandboxManager` exactly like `/api/chat`. `mark_run(advance=True/False)` advances cron / disables one-shots when called by the scheduler, leaves them untouched when called from `POST /api/tasks/{id}/run` (the manual run-now path). PATCH cleanly enforces "switching recurring→one-shot needs explicit `due_at`" so the cached cron timestamp can't silently become the one-shot. Frontend `/settings/tasks` mirrors the Plan 15 two-pane shape; runs default tz to `Intl.DateTimeFormat().resolvedOptions().timeZone`; run-now schedules two delayed `load()` polls (1.5s + 4s, cancelled on unmount) so the user sees the agent's actual outcome land. Agent-facing tools: `task_create / task_list / task_delete` (the old `reminder_*` / `todo_*` set is gone). New backend dep: `croniter`.
- [20](./20-onboarding-diagnostics-docs.md) — onboarding, diagnostics, and docs — **diagnostics slice only** (2026-05-30; cross-repo [Holzi#50](https://github.com/haexhub/Holzi/pull/50) + [holzi-frontend#54](https://github.com/haexhub/holzi-frontend/pull/54) merged). `GET /api/diagnostics` ships six redacted subsystem checks (database, LLM credential, messenger, scheduler with `_task.done()` liveness probe, workspace roots, sandbox runtime — message says "configured" because the manager survives a dead Podman socket); `display_name` is run through a single-line, length-capped summariser and the workspace root list collapses to the first three + count, so user-controlled fields can't dominate the response. `/settings/diagnostics` replaces the placeholder stub with a flat status list + a "Letzte Fehlläufe" panel pulling `/api/runs?status=error` (rows expand to reveal the persisted trace, fallback when `error_trace=null`). `settingsNav.ts` drops the `upcoming` hint on the diagnostics entry; `statusLabel` / `statusBadgeClass` back onto `satisfies Record<DiagnosticsStatus, string>` maps so future schema additions are TS-enforced. **Deferred to follow-up slices**: persistent sandbox-crash log table (closed by 20-A below), first-run / onboarding empty state in `EmptyChatState.vue`, README quickstart + troubleshooting + provider-setup docs, optional bootstrap/check CLI. `/api/health` stays Plan 19's concern.
- [20-A](./20a-sandbox-crash-log.md) — persistent sandbox-crash log (2026-05-30; cross-repo [Holzi#51](https://github.com/haexhub/Holzi/pull/51) + [holzi-frontend#56](https://github.com/haexhub/holzi-frontend/pull/56) merged). Closes the Plan 11b-b "Known limit": every workspace dead-transition the health watcher fires is persisted into a new `sandbox_crashes` table by a lifespan-registered handler that subscribes **before** `start_health_watcher`. New `GET /api/sandbox/crashes` (auth-gated, `limit` clamped 1..100, newest-first via `(crashed_at DESC, id DESC)` so sub-second collisions still order correctly). `/settings/diagnostics` grows a third section "Sandbox-Abstürze" between Subsysteme and "Letzte Fehlläufe" — renders even when the live sandbox subsystem-check is green. `state` typed as `Literal["crashed", "oom", "removed"]` on the response so the frontend's `CRASH_STATE_LABEL satisfies Record<SandboxCrashState, string>` stays exhaustive; canonical writer is `_DEAD_STATES` in `sandbox/manager.py`, and adding a state is a documented five-step cross-system change. CodeRabbit was credits-exhausted → self-reviewed via two parallel general-purpose agents; four backend findings addressed in `1642021` before merge (db-None guard, `crashed_at` description, cross-system docstring, handler-isolation test). Live verification of the **endpoint shape** + dev-stack restart cycle confirmed after Plan 20-B (`/api/sandbox/crashes` returns `[]` clean on a fresh Docker-host stack); the full Podman crash → DB row → page row → restart-survives loop still needs a Podman host and remains deferred to the haex.cloud box.
- [20-B](./20b-devstack-docker-agnostic.md) — dev-stack docker-agnostisch (2026-05-30; cross-repo [Holzi#52](https://github.com/haexhub/Holzi/pull/52) + [holzi-frontend#58](https://github.com/haexhub/holzi-frontend/pull/58) merged). Makefile auto-detects docker first then podman (override via `CONTAINER_BIN=` / `COMPOSE_BIN=`); sandbox-only env + Podman control-socket mount moved to a new `docker-compose.local.podman.yml` overlay layered in only when `CONTAINER_BIN=podman`. Nested `${HERMES_PODMAN_SOCKET:-${XDG_RUNTIME_DIR}/podman/podman.sock}` flattened to a single `HERMES_CONTAINER_SOCKET` so compose v2 + podman compose 4.x parse it identically. `${HERMES_CONTAINER_SOCKET:-/var/run/docker.sock}` keeps hand-run compose working; `/run/user/$(id -u)` fallback in the Makefile covers empty `XDG_RUNTIME_DIR` (sudo / cron / minimal CI shells). Self-reviewed via two parallel general-purpose agents (CodeRabbit credit-exhausted); three backend findings + two frontend findings addressed in `256dba4` + `0155277` before merge. Live verification: `make up-local-full` succeeds on the user's Docker-only host; all five containers up, diagnostics returns `sandbox: warning ("HERMES_SANDBOX_SOCKET not set")`, frontend serves 200 OK at `app.localhost`, `make down-local` cleans up. Production compose (`docker-compose.yml`) unchanged — production sandboxing stays hard rootless Podman per Plan 11b-a.
- [20-C](./20c-onboarding-empty-state.md) — diagnostics-aware EmptyChatState (2026-05-30; frontend-only [holzi-frontend#60](https://github.com/haexhub/holzi-frontend/pull/60) merged). `EmptyChatState.vue` fetched `/api/diagnostics` when credentials are configured; renders a subtle banner under "Sag Hermes Hallo." with singular/plural copy + link to `/settings/diagnostics` when `overall !== 'ok'`. Credentials-missing state unchanged (priority CTA stays alone). Diagnostics fetch rejection falls through silently — diagnostics-down is an auth/connectivity problem, not an onboarding signal. Watcher is one-shot per become-true transition; the EmptyState unmounts on first message so a stale cache is a non-issue. Self-reviewed via a parallel general-purpose agent (CR still credits-exhausted); all NITs, "ship it"; one inline comment addressed in `9d591f6`. Live verified on the user's Docker host: banner showed "3 Subsysteme melden Warnungen oder Fehler" (messenger + workspace + sandbox = warning by default on a sandbox-less Docker dev host), href `/settings/diagnostics`. Tests: 6 new component cases (`hasCredentials` × diagnostics-overall + fetch-rejects fallthrough), vitest suite 196/196 green, typecheck green.

Next up: [17 — Cline/Roo first-class channel](./17-cline-roo-first-class-channel.md), or the remaining Plan 20 follow-up (README quickstart + troubleshooting + provider-setup docs). Plan 18 (Profiles/Spaces) is "do not implement unless a new need appears" per the recommended order; Plan 19 is the bigger production-hardening pass.

## Recommended Order

1. [Conversation lifecycle](./01-conversation-lifecycle.md)
1b. [Conversation retention and bookmarks](./01b-conversation-retention-and-bookmarks.md)
2. [Conversation search and organization](./02-conversation-search-organization.md)
3. [Chat cancel and run state](./03-chat-cancel-and-run-state.md)
3b. [Agent runs and observability](./03b-agent-runs-and-observability.md)
4. [Retry last response](./04-chat-retry-last-response.md)
5. [Edit and regenerate](./05-chat-edit-and-regenerate.md)
6. [Streaming resilience and queued sends](./06-streaming-resilience-and-queueing.md)
7. [Chat rendering polish](./07-chat-rendering-polish.md)
8. [Tool call cards + event taxonomy](./08-tool-call-cards.md)
9. [Approvals and safety cards](./09-approval-cards.md)
10. [Reasoning and subagent cards](./10-reasoning-and-subagent-cards.md)
11. [Attachments](./11-attachments.md)
11b-a. [Sandbox spine (lifecycle + exec + isolation)](./11b-a-sandbox-spine.md)
11b-b. [Sandbox runtime remainder (read/write/git + health + UI)](./11b-sandbox-runtime.md)
12. [Workspace browser read-only](./12-workspace-browser-readonly.md)
13. [Workspace write operations and Git status](./13-workspace-write-git.md)
14. [Control center shell](./14-control-center-shell.md)
15. [Memory panel](./15-memory-panel.md)
16. [Tasks and cron panel](./16-tasks-cron-panel.md)
17. [Cline/Roo first-class channel](./17-cline-roo-first-class-channel.md)
18. [Profiles, spaces, and model routing](./18-profiles-spaces-model-routing.md) — likely supplanted by workspaces; do not implement unless a new need appears
19. [Production hardening](./19-production-hardening.md)
20. [Onboarding, diagnostics, and docs](./20-onboarding-diagnostics-docs.md)

### Dependencies

The list above is a recommended order, not a strict topological sort. Each plan
states its own `Depends on:` line. The non-obvious links to remember:

- 08 establishes the SSE event envelope (`event`, `version`, `data`); 09 and 10
  add new event types but reuse the envelope.
- 11 (attachments) relies on the per-conversation scratch directory introduced
  in 01b.
- 11b introduces sandbox containers; 12 and 13 (workspace) and 16 (tasks/cron
  that execute code) all route their risky work through sandboxes from there.
- 13's "Save" means a workspace file write, not a conversation save (there is
  no such thing). Conflict detection only applies when the user opts in to
  bind-mounting the workspace volume to a host directory.
- 20 (diagnostics) consumes the run history exposed by 03b and the sandbox
  crash log exposed by 11b.

## Session Definition

Each plan is intended to be small enough for one focused implementation session.
If a plan starts to sprawl, split it before implementation. A good session ends
with:

- backend and frontend code compiling
- targeted tests added or updated
- generated API types refreshed if backend shapes changed
- a short manual verification note
- no unrelated refactors

## Cross-Repo Workflow

Most plans touch both repositories:

- backend: `/home/haex/Projekte/Holzi`
- frontend: `/home/haex/Projekte/holzi-frontend`

When a backend API changes:

1. Add or update backend tests first.
2. Implement the backend endpoint/schema.
3. Regenerate frontend API types.
4. Implement the frontend.
5. Add frontend tests for composables or high-risk UI state.

## Non-Goals

- Do not replace Holzi with upstream Hermes WebUI.
- Do not copy upstream file structure blindly.
- Do not make the web UI the source of truth for agent state.
- Do not add a large abstraction unless it is needed by at least two clients.
