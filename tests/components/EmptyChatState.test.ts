import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import EmptyChatState from '~/components/chat/EmptyChatState.vue'
import type { DiagnosticsResponse } from '~/types/api'

// Plan 20-C: EmptyChatState fetches /api/diagnostics when the user has
// credentials so it can surface "Setup unvollständig" with a link to
// /settings/diagnostics. These tests cover the matrix of credential
// state × diagnostics overall, plus the silent-fallthrough on fetch error.

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

const stubs = {
  // NuxtLink isn't registered without a Nuxt runtime; render the href so
  // tests can assert it. The default slot becomes the link's text body.
  NuxtLink: {
    name: 'NuxtLink',
    props: ['to'],
    template: '<a :href="to" data-stub-nuxtlink><slot /></a>',
  },
  // The shared shadcn-vue Button uses Radix internals that don't survive
  // happy-dom cleanly here; stub it to a plain wrapper since these tests
  // never assert on the Button itself.
  Button: {
    name: 'Button',
    props: ['size', 'asChild'],
    template: '<div data-stub-button><slot /></div>',
  },
}

function diagnostics(
  overall: DiagnosticsResponse['overall'],
  nonOkCount = 0,
): DiagnosticsResponse {
  const checks: DiagnosticsResponse['checks'] = [
    { id: 'database', label: 'Database', status: 'ok', message: 'reachable' },
    { id: 'llm', label: 'LLM', status: 'ok', message: 'configured' },
    {
      id: 'messenger',
      label: 'Messenger',
      status: 'ok',
      message: 'configured',
    },
    {
      id: 'scheduler',
      label: 'Scheduler',
      status: 'ok',
      message: 'running',
    },
    {
      id: 'workspace',
      label: 'Workspaces',
      status: 'ok',
      message: 'configured',
    },
    {
      id: 'sandbox',
      label: 'Sandbox runtime',
      status: 'ok',
      message: 'configured',
    },
  ]
  for (let i = 0; i < nonOkCount && i < checks.length; i++) {
    checks[i] = {
      ...checks[i],
      status: overall === 'error' ? 'error' : 'warning',
    }
  }
  return { overall, checks }
}

beforeEach(() => {
  apiGet.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('EmptyChatState', () => {
  it('renders nothing while credentials are still loading', () => {
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: null },
      global: { stubs },
    })
    expect(wrapper.text()).toBe('')
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('renders the credentials CTA and does NOT fetch diagnostics when credentials are missing', () => {
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: false },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Willkommen bei Hermes')
    expect(wrapper.text()).toContain('Credentials einrichten')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('renders just "Sag Hermes Hallo." when diagnostics overall is ok', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('ok'))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/diagnostics', undefined)
    expect(wrapper.text()).toContain('Sag Hermes Hallo.')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
  })

  it('renders the diagnostics banner with plural copy for >1 finding', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('warning', 2))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    const banner = wrapper.find('[data-testid="empty-state-diagnostics-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Setup unvollständig')
    expect(banner.text()).toContain('2 Subsysteme melden')
    expect(banner.attributes('href')).toBe('/settings/diagnostics')
  })

  it('renders the diagnostics banner with singular copy for exactly 1 finding', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('error', 1))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    const banner = wrapper.find('[data-testid="empty-state-diagnostics-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('1 Subsystem meldet')
  })

  it('falls through silently when /api/diagnostics rejects', async () => {
    apiGet.mockRejectedValueOnce(new Error('connectivity'))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Sag Hermes Hallo.')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
  })
})
