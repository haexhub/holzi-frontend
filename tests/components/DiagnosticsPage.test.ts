import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DiagnosticsPage from '~/pages/settings/diagnostics.vue'
import type { AgentRun, DiagnosticsResponse } from '~/types/api'

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

// `apiGet` is called twice on mount (loadDiagnostics + loadFailures, in
// parallel via Promise.all). Helper to resolve them per call site so each
// test stays explicit about what it's stubbing.
function setupGet(diag: DiagnosticsResponse | Error, failures: AgentRun[] | Error) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/diagnostics') {
      return diag instanceof Error ? Promise.reject(diag) : Promise.resolve(diag)
    }
    if (path === '/api/runs') {
      return failures instanceof Error
        ? Promise.reject(failures)
        : Promise.resolve(failures)
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

  it('refresh button retriggers both endpoints', async () => {
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
  })
})
