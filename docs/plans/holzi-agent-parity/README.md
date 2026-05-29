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

Next up: [13 — workspace write + git](./13-workspace-write-git.md) builds on the runtime + browser to add the first agent-driven write tools and surface git status; or stay UI-facing with [14 — control-center shell](./14-control-center-shell.md).

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
