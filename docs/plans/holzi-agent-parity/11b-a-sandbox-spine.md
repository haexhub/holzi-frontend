# Plan 11b-a: Sandbox Spine (lifecycle + exec + isolation)

Status: implemented (2026-05-27), backend-only — awaiting review/merge. First half
of the split of [11b](./11b-sandbox-runtime.md).
Depends on: [01b](./01b-conversation-retention-and-bookmarks.md) (data layout).

## Why this is split

The original [11b](./11b-sandbox-runtime.md) bundles: container lifecycle, a full
internal API (exec + read/write + git + restart/shutdown), resource limits,
network isolation with hardening tests, a health watcher with a new SSE event,
and the first frontend surface (badge/restart/WorkspacePanel/diagnostics). That
is 2–3 sessions of work, so it is split per the roadmap's "split before
implementation" rule.

Note also: the agent has **no** code-execution, shell, or file-write tools
today (its tools are memory/notes/web/reminders/todos/cross-channel). 11b builds
runtime *ahead* of its first consumer — the exec/write tools land in Plans 13
(workspace writes) and 16 (tasks/cron). So this spine ships the minimum runtime
that those later plans can build on, not a speculative full API.

- **11b-a (this plan):** runtime abstraction, container lifecycle (workspace +
  ephemeral), a single `exec` primitive (streamed stdout/stderr), mandatory
  resource limits, and network isolation — the *safety-critical* half.
- **11b-b (next):** read_file/write_file/git in the internal API, health watcher
  → `sandbox_crashed` SSE event + restart endpoint, and the frontend
  badge/restart/minimal WorkspacePanel/diagnostics surface.

## Goal

Stand up the sandbox runtime so that a command can be executed in an isolated
container that the agent can start, stream output from, and stop — and whose
crash, OOM, or hostile script cannot take down the agent. No agent tool wires
into it yet; the verification surface is tests plus one manual run.

## Container runtime decision: rootless Podman, sibling containers

Chosen over the Docker socket. Rationale:

- **No privileged daemon socket.** Mounting `/var/run/docker.sock` grants
  root-equivalent host control and is the exact attack surface this plan exists
  to remove.
- **Daemonless.** Podman has no central daemon whose failure propagates to the
  agent; a sandbox crash stays local — the property we need.
- **Rootless.** Sandboxes run in a non-root user namespace.
- **Docker-API-compatible.** The rootless Podman user socket
  (`$XDG_RUNTIME_DIR/podman/podman.sock`) speaks the Docker REST API, so the
  concrete backend uses an ordinary Docker-API client. Code stays runtime-neutral
  behind the `SandboxBackend` abstraction; only the concrete backend + compose
  know it is Podman.

Topology: agent container → rootless Podman socket → spawns sandbox **sibling**
containers (no DinD, no nested daemon) attached to a dedicated locked-down
network.

### Dev-stack consequence (integration step)

`make up-local-full` runs the stack under Docker today. For the agent container
to spawn rootless-Podman siblings it must itself run on a Podman-compatible
stack (`podman compose`). This plan keeps all code runtime-neutral; the actual
dev-stack migration + manual verification is the final integration step and
requires a full stack restart. If the migration proves larger than expected, it
becomes a tracked follow-up and 11b-a's manual verification is done against a
host-side rootless Podman socket instead.

## Backend

New package `src/hermes/sandbox/`:

- `kinds.py` — `SandboxKind` enum: `workspace` | `ephemeral`.
- `backend.py` — `SandboxBackend` protocol (the abstraction the tests target):
  - `create(spec) -> SandboxHandle`
  - `exec(handle, argv, *, cwd, env) -> async iterator of (stream, bytes)` for
    streamed stdout/stderr, plus a final exit code
  - `status(handle) -> SandboxStatus`
  - `stop(handle)` / `remove(handle)`
  - A `SandboxSpec` carries: kind, image, resource limits (CPU, RAM, disk),
    network name, workspace volume (workspace kind only).
- `podman.py` — `PodmanSandboxBackend`, the concrete Docker-API-client backend
  pointed at the rootless Podman socket. Sets resource limits and the dedicated
  network at create time.
- `fake.py` — `FakeSandboxBackend` for unit tests: in-memory lifecycle, scriptable
  exec output/exit codes, simulable crash/OOM, leak accounting.
- `manager.py` — `SandboxManager` on `app.state` (single-worker invariant, like
  the existing `chat_runs`/`approvals` registries):
  - workspace sandboxes: keyed by workspace id, auto-start on first use, persist,
    restartable
  - ephemeral sandboxes: created per call, **always** removed in a `finally`
  - holds the chosen backend (Podman in prod, Fake in tests)

Resource limits are mandatory — `SandboxSpec` has no "unlimited" path; `create`
without limits is a programming error.

`Dockerfile.sandbox` (new): minimal image for the sandbox container (shell +
the in-container exec entrypoint that the internal API talks to). 11b-a only
needs the `exec` path of that entrypoint.

`docker-compose.local.yml`: define the dedicated isolated sandbox network and
expose the rootless Podman socket to the agent container. No sandbox *service*
is declared — sandboxes are spawned dynamically by the manager.

Config (`config.py`): `HERMES_SANDBOX_*` settings — image tag, network name,
default CPU/RAM/disk limits, runtime socket path. Sensible defaults; off-path
when no backend is configured (tests use Fake).

## Frontend

None in 11b-a. The badge/restart/panel surface is 11b-b. (No `gen:api` run is
needed unless a backend schema changes; 11b-a adds no new SSE event or
request/response model — `sandbox_crashed` is 11b-b.)

## Tests (`tests/test_sandbox.py`, against FakeSandboxBackend)

- Killing/crashing a sandbox does not raise into or stop the agent; the manager
  reports the sandbox as dead and the agent process is unaffected.
- A sandbox OOM surfaces as a distinct status (not a generic error) — the
  recoverable signal 11b-b's health watcher will consume.
- Ephemeral sandboxes are removed after the call, including on exception
  (no leaked handles after N runs — assert the backend's live-handle count
  returns to zero).
- Resource limits are always present on the spec the manager hands the backend
  (no unlimited path).
- Network isolation: the spec attaches the sandbox only to the dedicated
  network and never to the agent's internal/DB/secrets network (assert against
  the spec the manager builds; the real-Podman enforcement is checked in the
  manual integration step).
- `exec` streams stdout and stderr incrementally and reports the exit code.

Real-Podman integration tests are marked (`@pytest.mark.integration`/docker),
opt-in, and excluded from the default suite.

## Acceptance Criteria (subset of 11b applicable now)

- Container runtime is rootless Podman via the Docker-compatible socket; no
  Docker daemon socket is mounted into the agent.
- The manager can create, stream-exec, and stop both workspace and ephemeral
  sandboxes.
- Resource limits (CPU/RAM/disk) are enforced on every sandbox.
- The sandbox network cannot reach the agent's DB, secrets, or other sandboxes
  (asserted at spec level here; enforced for real in the manual integration run).
- Killing a sandbox does not affect the agent.

Deferred to 11b-b: `sandbox_crashed` SSE event, restart-from-UI, conversation
survival across restart, read/write/git internal API, all frontend.

## Out Of Scope (unchanged from 11b)

- Multi-tenant sandbox sharing; gVisor/firecracker/VM-grade isolation; sandbox
  host migration; per-conversation sandbox lifetime (workspace is the boundary).

## Files Likely Touched

- Holzi backend:
  - `src/hermes/sandbox/{__init__,kinds,backend,podman,fake,manager}.py` (new)
  - `src/hermes/config.py` (sandbox settings)
  - `src/hermes/main.py` (manager on `app.state` lifespan)
  - `Dockerfile.sandbox` (new)
  - `docker-compose.local.yml` (isolated network + Podman socket)
  - `tests/test_sandbox.py` (new)
- Frontend: none.

## Manual Verification

Run the dev stack under Podman, trigger a manager `exec` of a short command in a
workspace sandbox, observe streamed output; kill the sandbox container and
confirm the agent stays up and healthy; confirm the sandbox container cannot
reach the agent DB/secret network (e.g. `podman exec` a curl to the agent's
internal address fails).

## Implementation Notes (2026-05-27)

Backend landed in `src/hermes/sandbox/`:
- `models.py` — `SandboxKind`/`SandboxState` (StrEnum), `ResourceLimits` (rejects
  non-positive caps — no unlimited path), `SandboxSpec` (validates
  workspace/ephemeral invariants), `SandboxHandle`, `SandboxStatus`, and the
  `ExecOutput`/`ExecExit` stream event union.
- `backend.py` — `SandboxBackend` Protocol; `errors.py` — `SandboxError` /
  `SandboxNotRunning`.
- `manager.py` — `SandboxManager`, the sole `SandboxSpec` builder (the
  limits/isolation chokepoint); workspace auto-start/persist/restart, ephemeral
  always-removed context manager, `shutdown()` removes all workspaces.
- `podman.py` — `PodmanSandboxBackend` over the rootless Podman Docker-API socket
  (httpx UDS): create with NanoCpus/Memory/StorageOpt + `NetworkMode`, exec with
  Docker stream demux, OOM-aware status mapping.
- `fake.py` — `FakeSandboxBackend` (scriptable exec, simulable crash/OOM, live
  accounting) — the unit-test double.
- `factory.py` + `config.py` `HERMES_SANDBOX_*` — manager built in `main.py`
  lifespan only when a socket is configured; `None` otherwise (agent boots
  sandbox-less; tests use the fake).

Infra: `Dockerfile.sandbox` (minimal debian, unprivileged `sandbox` user, idle
`sleep infinity`); `docker-compose.local.yml` adds the isolated `hermes-sandbox`
network and mounts the rootless Podman socket into the agent (agent stays on
`hermes-local` only); `Makefile`/stack migrated to `podman compose`
(`CONTAINER_BIN ?= podman`, new `sandbox-image` target). Traefik now reads the
Podman socket.

Tests: `tests/test_sandbox.py` (14, against the fake — limits, isolation,
lifecycle, ephemeral cleanup/no-leak, exec streaming, crash/OOM resilience,
restart, shutdown); `tests/test_sandbox_podman_integration.py` (opt-in,
`-m integration`, skipped without `HERMES_SANDBOX_SOCKET`). Full suite: 457
passed, 2 deselected; ruff + mypy clean. No `gen:api` (no API/SSE schema change).

### Live Podman verification (2026-05-27)

Ran against a real rootless Podman socket (Podman 3.4.4, ext4, cgroup v2).
Results:

- **exec stream demux verified end-to-end** — `PodmanSandboxBackend.exec`
  against a real container correctly splits stdout/stderr, reassembles frames,
  and returns the true non-zero exit code (3). This was the highest-risk
  untested code; it is now proven.
- **memory cap + isolated network create/start/run verified working.**
- Three environment/host requirements surfaced (not code bugs in the create
  path, which uses standard Docker-API options):
  - **Disk quota** (`StorageOpt size`) only works on XFS+pquota storage; ext4
    rejects it and fails the create. **Fixed:** disk quota is now opt-in via
    `HERMES_SANDBOX_DISK_QUOTA` (default off); `disk_mb` stays in the spec but
    is only applied to the overlay when enabled on supported storage.
  - **CPU cap** (`NanoCpus`) needs the host to delegate the `cpu` cgroup
    controller to the rootless user slice (`Delegate=cpu cpuset io memory pids`
    in `/etc/systemd/system/user@.service.d/delegate.conf` + `daemon-reload` +
    session restart). Confirmed the sole remaining create blocker on a box
    without it; memory + pids are delegated by default.
  - **Networking** — Podman 3.4.4's bundled CNI writes `cniVersion 1.0.0`,
    which its firewall plugin rejects; pinning the conflist to `0.4.0` (or
    Podman 4.x with netavark) fixes it. Not an issue on the 4.x target.

**Still open:** a fully green `pytest -m integration` on a host with cpu cgroup
delegation (and the full `podman compose` stack bring-up — Podman 3.4.4 has no
`podman compose`, needs 4.x or `podman-compose`). The agent-survives-sandbox-
kill and network-isolation curl checks are pending that host.
