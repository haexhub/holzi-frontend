# Plan 11b: Sandbox Runtime

Depends on: [01b](./01b-conversation-retention-and-bookmarks.md) (data layout).

## Goal

Keep the agent container unkillable. Any operation that runs user/agent code,
performs unbounded file writes, or executes arbitrary shell must happen in an
isolated sandbox container, not in the agent process.

## Why

The agent is supposed to be always reachable. A runaway tool call, an OOM
during a build, or a hostile script must take down at most a sandbox, never
the agent.

## Sandbox Topology

Three roles, three container shapes:

- **Agent container** — always up, lightweight, single worker. Hosts LLM
  calls, conversation/memory storage, routing, and read-only tools (DB
  lookups, web search, memory queries).
- **Workspace sandbox** — one persistent container per workspace, restartable.
  Owns the workspace volume. Hosts file writes, builds, tests, git operations,
  and any code execution scoped to that workspace.
- **Ephemeral execution sandbox** — one-shot container spawned for a single
  task (e.g. "run this Python snippet" outside any workspace), destroyed when
  the task ends.

Anything that doesn't fall in the "code execution / unbounded write / shell"
bucket stays in the agent container. The principle is *isolate risk*, not
*one container per tool call*.

## Backend

- Define a `sandbox_kind` enum: `workspace` | `ephemeral`.
- Sandboxes expose a small internal API (HTTP over a private network or a UDS
  socket) for:
  - `exec` (run a command, stream stdout/stderr)
  - `read_file` / `write_file`
  - `git` operations
  - status / restart / shutdown
- Lifecycle:
  - workspace sandboxes auto-start on first use, persist across runs, restart
    on demand
  - ephemeral sandboxes are created per call, destroyed after
- Resource limits per container (CPU, RAM, disk) are mandatory.
- Health: agent watches sandbox liveness; a crashed workspace sandbox surfaces
  as a `sandbox_crashed` event in the chat and offers a Restart action.

## Frontend

- Sandbox status badge on workspaces.
- Restart action on the workspace panel.
- "Recent sandbox crashes" surface on Diagnostics ([Plan 20](./20-onboarding-diagnostics-docs.md)).

## Tests

- Killing a sandbox container does not kill the agent.
- A sandbox OOM is reported and recoverable.
- Ephemeral sandboxes are cleaned up after task completion (no leaked
  containers after N runs).
- Resource limits are enforced.
- Sandbox cannot reach the agent's DB, secrets, or other sandboxes (network
  isolation test).

## Acceptance Criteria

- The agent container has no code-execution or arbitrary-shell tools.
- Every "run command" or "write file" tool call routes through a sandbox.
- A crashed sandbox is restartable from the UI; the conversation survives.
- Sandboxes cannot reach the agent's DB, secrets, or other sandboxes.

## Out Of Scope

- Multi-tenant sandbox sharing across users (still one user per agent).
- gVisor / firecracker / VM-grade isolation; standard Docker isolation is
  enough for v1.
- Sandbox migration between hosts.
- Per-conversation sandbox lifetime (workspace is the boundary, not
  conversation).

## Files Likely Touched

- Holzi backend:
  - `src/hermes/sandbox/` (new)
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `Dockerfile.sandbox` (new)
  - `docker-compose.yml`
  - `tests/test_sandbox.py`
- Frontend:
  - `app/components/panels/WorkspacePanel.vue`
  - `app/pages/settings/diagnostics.vue`
