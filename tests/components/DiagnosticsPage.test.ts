import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DiagnosticsPage from '~/pages/settings/diagnostics.vue'
import type {
  AgentRun,
  DiagnosticsResponse,
  SandboxCrash,
} from '~/types/api'

const apiGet = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

function diagnostics(
  overrides: Partial<DiagnosticsResponse> = {},
): DiagnosticsResponse {
  return {
    overall: overrides.overall ?? 'ok',
    checks: overrides.checks ?? [
      { id: 'database', label: 'Database', status: 'ok', message: 'reachable' },
      {
        id: 'llm',
        label: 'LLM',
        status: 'warning',
        message: 'no active credential',
      },
      {
        id: 'messenger',
        label: 'Messenger',
        status: 'warning',
        message: 'no active account',
      },
      { id: 'scheduler', label: 'Scheduler', status: 'ok', message: 'running' },
      {
        id: 'workspace',
        label: 'Workspaces',
        status: 'warning',
        message: 'no roots',
      },
      {
        id: 'sandbox',
        label: 'Sandbox runtime',
        status: 'warning',
        message: 'not configured',
      },
    ],
  }
}

function run(overrides: Partial<AgentRun> & { id: string }): AgentRun {
  return {
    id: overrides.id,
    conversation_id: overrides.conversation_id ?? 1,
    channel: overrides.channel ?? 'web',
    model: overrides.model ?? 'claude-opus-4-7',
    started_at: overrides.started_at ?? 1_700_000_000,
    finished_at: overrides.finished_at ?? 1_700_000_005,
    status: overrides.status ?? 'error',
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
    error_trace: overrides.error_trace ?? null,
    input_tokens: overrides.input_tokens ?? null,
    output_tokens: overrides.output_tokens ?? null,
  }
}

function crash(overrides: Partial<SandboxCrash> & { id: number }): SandboxCrash {
  return {
    id: overrides.id,
    workspace_id: overrides.workspace_id ?? 'ws-1',
    sandbox_id: overrides.sandbox_id ?? 'cont-abc',
    crashed_at: overrides.crashed_at ?? 1_700_000_000,
    state: overrides.state ?? 'crashed',
    exit_code: overrides.exit_code ?? null,
    last_message: overrides.last_message ?? null,
  }
}

// `apiGet` is called three times on mount (loadDiagnostics + loadFailures
// + loadCrashes, in parallel via Promise.all). Helper to resolve them per
// call site so each test stays explicit about what it's stubbing.
function setupGet(
  diag: DiagnosticsResponse | Error,
  failures: AgentRun[] | Error,
  crashes: SandboxCrash[] | Error = [],
) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/diagnostics') {
      return diag instanceof Error ? Promise.reject(diag) : Promise.resolve(diag)
    }
    if (path === '/api/runs') {
      return failures instanceof Error
        ? Promise.reject(failures)
        : Promise.resolve(failures)
    }
    if (path === '/api/sandbox/crashes') {
      return crashes instanceof Error
        ? Promise.reject(crashes)
        : Promise.resolve(crashes)
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

describe('settings/diagnostics.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders every check with the right label and status badge', async () => {
    setupGet(diagnostics({ overall: 'warning' }), [])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/diagnostics', undefined)
    expect(apiGet).toHaveBeenCalledWith('/api/runs', {
      status: 'error',
      limit: 20,
    })

    for (const id of [
      'database',
      'llm',
      'messenger',
      'scheduler',
      'workspace',
      'sandbox',
    ]) {
      const row = wrapper.find(`[data-testid="diagnostics-check-${id}"]`)
      expect(row.exists(), `check ${id} row missing`).toBe(true)
    }
    // Overall badge mirrors the worst child.
    expect(wrapper.get('[data-testid="diagnostics-overall"]').text()).toBe(
      'Warnung',
    )
  })

  it('shows the empty state when there are no failed runs', async () => {
    setupGet(diagnostics(), [])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-failures-empty"]').exists(),
    ).toBe(true)
  })

  it('lists failed runs and reveals the trace on click', async () => {
    setupGet(diagnostics({ overall: 'error' }), [
      run({
        id: 'run-1',
        error_code: 'UpstreamTimeout',
        error_message: 'request timed out after 30s',
        error_trace: 'Traceback (most recent call last):\n  ...\n  TimeoutError',
      }),
    ])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    const item = wrapper.get('[data-testid="diagnostics-failure-run-1"]')
    expect(item.text()).toContain('UpstreamTimeout')
    expect(item.text()).toContain('request timed out')
    // Collapsed by default — trace not in the DOM.
    expect(item.text()).not.toContain('TimeoutError')

    await item.get('button').trigger('click')
    await flushPromises()
    expect(item.text()).toContain('TimeoutError')
  })

  it('surfaces a diagnostics load error without hiding the failures section', async () => {
    setupGet(new Error('boom'), [])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-checks-error"]').text(),
    ).toContain('boom')
    // Failures section still renders its empty state independently.
    expect(
      wrapper.find('[data-testid="diagnostics-failures-empty"]').exists(),
    ).toBe(true)
  })

  it('shows a fallback when an expanded run has no stored traceback', async () => {
    setupGet(diagnostics({ overall: 'error' }), [
      run({
        id: 'run-2',
        error_code: 'WorkspaceMissing',
        error_message: 'workspace gone',
        error_trace: null,
      }),
    ])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    const item = wrapper.get('[data-testid="diagnostics-failure-run-2"]')
    await item.get('button').trigger('click')
    await flushPromises()

    expect(item.text()).toContain('Kein Traceback gespeichert')
  })

  it('surfaces a failures-load error in its own panel', async () => {
    setupGet(diagnostics(), new Error('runs boom'))
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-failures-error"]').text(),
    ).toContain('runs boom')
    // Subsystem check list keeps rendering — the failures-load failure
    // shouldn't collapse the rest of the page.
    expect(
      wrapper.find('[data-testid="diagnostics-check-database"]').exists(),
    ).toBe(true)
  })

  it('refresh button retriggers all three endpoints', async () => {
    setupGet(diagnostics(), [])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()
    apiGet.mockClear()

    await wrapper.get('[data-testid="diagnostics-refresh"]').trigger('click')
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/diagnostics', undefined)
    expect(apiGet).toHaveBeenCalledWith('/api/runs', {
      status: 'error',
      limit: 20,
    })
    expect(apiGet).toHaveBeenCalledWith('/api/sandbox/crashes', { limit: 20 })
  })

  // ── Sandbox crashes (Plan 20-A) ───────────────────────────────────────

  it('shows the empty state when there are no sandbox crashes', async () => {
    setupGet(diagnostics(), [], [])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-crashes-empty"]').exists(),
    ).toBe(true)
  })

  it('lists sandbox crashes in API order with state badge + exit code', async () => {
    setupGet(diagnostics(), [], [
      crash({
        id: 7,
        workspace_id: 'projects',
        sandbox_id: 'cont-newest',
        crashed_at: 1_700_000_300,
        state: 'oom',
        exit_code: null,
      }),
      crash({
        id: 6,
        workspace_id: 'scratch',
        sandbox_id: 'cont-older',
        crashed_at: 1_700_000_000,
        state: 'crashed',
        exit_code: 137,
      }),
    ])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    const newest = wrapper.get('[data-testid="diagnostics-crash-7"]')
    expect(newest.text()).toContain('projects')
    expect(newest.text()).toContain('Out of memory')
    // No exit code → '—' fallback, not "null" or "0".
    expect(newest.text()).toContain('exit —')

    const older = wrapper.get('[data-testid="diagnostics-crash-6"]')
    expect(older.text()).toContain('scratch')
    expect(older.text()).toContain('Crashed')
    expect(older.text()).toContain('exit 137')
    expect(older.text()).toContain('cont-older')
  })

  it('renders the crashes section even when the sandbox subsystem-check is green', async () => {
    // Past crashes still matter when the live runtime is healthy now.
    setupGet(
      diagnostics({
        overall: 'ok',
        checks: [
          { id: 'database', label: 'Database', status: 'ok', message: 'reachable' },
          { id: 'llm', label: 'LLM', status: 'ok', message: 'active' },
          { id: 'messenger', label: 'Messenger', status: 'ok', message: 'active' },
          { id: 'scheduler', label: 'Scheduler', status: 'ok', message: 'running' },
          { id: 'workspace', label: 'Workspaces', status: 'ok', message: '1 root' },
          {
            id: 'sandbox',
            label: 'Sandbox runtime',
            status: 'ok',
            message: 'configured',
          },
        ],
      }),
      [],
      [crash({ id: 9, sandbox_id: 'cont-survivor', state: 'crashed', exit_code: 1 })],
    )
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-check-sandbox"]').exists(),
    ).toBe(true)
    expect(
      wrapper.get('[data-testid="diagnostics-crash-9"]').exists(),
    ).toBe(true)
  })

  it('surfaces a crashes-load error in its own panel', async () => {
    setupGet(diagnostics(), [], new Error('crashes boom'))
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-crashes-error"]').text(),
    ).toContain('crashes boom')
    // The other two sections still render — one failing endpoint must
    // not collapse the rest.
    expect(
      wrapper.find('[data-testid="diagnostics-check-database"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="diagnostics-failures-empty"]').exists(),
    ).toBe(true)
  })

  it('renders last_message when supplied', async () => {
    setupGet(diagnostics(), [], [
      crash({
        id: 12,
        sandbox_id: 'cont-with-msg',
        state: 'crashed',
        exit_code: 1,
        last_message: 'killed by user',
      }),
    ])
    const wrapper = mount(DiagnosticsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="diagnostics-crash-12"]').text(),
    ).toContain('killed by user')
  })
})
