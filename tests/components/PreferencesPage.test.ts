import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PreferencesPage from '~/pages/settings/preferences.vue'
import type {
  ChannelPrompt,
  ChannelPromptListResponse,
  Persona,
  PersonaHistoryItem,
  PersonaHistoryListResponse,
  PersonaListResponse,
} from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) =>
      apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: (path: string, body?: unknown) => apiPut(path, body),
    patch: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

const confirmFn = vi.fn()
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => confirmFn(opts) }),
}))

// Plan 30 Wave 0: language picker uses the @nuxtjs/i18n-augmented
// `setLocale` from useI18n({ useScope: 'global' }). The composer must
// be partially mocked so the rest of the runtime (createI18n etc.) stays
// intact — see the importOriginal shim. `localeRef` is a real Vue ref so
// proxyRefs auto-unwraps it in the template.
const setLocaleMock = vi.fn()
const localeRef = ref('de')
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({
      t: (key: string) => key,
      locale: localeRef,
      locales: ref([
        { code: 'de', name: 'Deutsch' },
        { code: 'en', name: 'English' },
      ]),
      setLocale: setLocaleMock,
    }),
  }
})

function persona(over: Partial<Persona> & { id: number; name: string }): Persona {
  return {
    id: over.id,
    name: over.name,
    // Plan 36 (Wave A1): single `prompt` was split into three fragments.
    soul: over.soul ?? 'soul body',
    identity: over.identity ?? 'identity body',
    agents: over.agents ?? 'agents body',
    is_default: over.is_default ?? false,
    created_at: over.created_at ?? 1_700_000_000,
    updated_at: over.updated_at ?? 1_700_000_000,
  }
}

function historyEntry(
  over: Partial<PersonaHistoryItem> & {
    id: number
    persona_id: number
  },
): PersonaHistoryItem {
  return {
    id: over.id,
    persona_id: over.persona_id,
    author: over.author ?? 'user',
    snapshot: over.snapshot ?? {
      soul: 'old soul',
      identity: 'old identity',
      agents: 'old agents',
    },
    created_at: over.created_at ?? 1_700_000_000,
  }
}

function channel(
  over: Partial<ChannelPrompt> & { channel: string; label: string },
): ChannelPrompt {
  const promptText = over.prompt ?? 'default-prompt'
  return {
    channel: over.channel,
    label: over.label,
    default_prompt: over.default_prompt ?? promptText,
    prompt: promptText,
    is_default_prompt:
      over.is_default_prompt
        ?? promptText === (over.default_prompt ?? promptText),
    default_persona_id: over.default_persona_id ?? null,
    updated_at: over.updated_at ?? 1_700_000_000,
  }
}

const defaultPersona = persona({
  id: 1,
  name: 'Hermes',
  soul: 'Default Hermes soul',
  identity: 'Default Hermes identity',
  agents: 'Default Hermes agents',
  is_default: true,
})

const fourChannels: ChannelPrompt[] = [
  channel({ channel: 'web', label: 'Web-Chat' }),
  channel({ channel: 'task', label: 'Geplante Tasks' }),
  channel({ channel: 'signal', label: 'Signal' }),
  channel({ channel: 'telegram', label: 'Telegram' }),
]

function mockInitialLoad(
  personas: Persona[] = [defaultPersona],
  channels: ChannelPrompt[] = fourChannels,
) {
  const personaResp: PersonaListResponse = { personas }
  const channelResp: ChannelPromptListResponse = { channels }
  const personaSkillsRe = /^\/api\/personas\/(\d+)\/skills$/
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/personas') return Promise.resolve(personaResp)
    if (path === '/api/channels') return Promise.resolve(channelResp)
    // Plan 33: the page now loads /api/skills + per-persona skill
    // lists so the persona cards can render the activation sub-block.
    // Tests that don't care about skills get an empty surface.
    if (path === '/api/skills') return Promise.resolve({ skills: [] })
    if (personaSkillsRe.test(path)) {
      return Promise.resolve({ skills: [] })
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

describe('settings/preferences.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    confirmFn.mockResolvedValue(true)
    setLocaleMock.mockReset()
    localeRef.value = 'de'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the default persona card and four channel cards on first load', async () => {
    mockInitialLoad()
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true)
    })

    expect(apiGet).toHaveBeenCalledWith('/api/personas', undefined)
    expect(apiGet).toHaveBeenCalledWith('/api/channels', undefined)
    expect(
      wrapper.find('[data-testid="persona-default-badge"]').exists(),
    ).toBe(true)

    for (const c of fourChannels) {
      expect(
        wrapper.find(`[data-testid="channel-card-${c.channel}"]`).exists(),
      ).toBe(true)
    }
  })

  it('creates a new persona via the inline form and reloads', async () => {
    mockInitialLoad()
    apiPost.mockResolvedValueOnce(
      persona({
        id: 2,
        name: 'Reviewer',
        soul: 'Be picky',
        identity: 'A reviewer.',
        agents: 'review code',
      }),
    )

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="personas-new-button"]').trigger('click')
    await wrapper
      .get('[data-testid="personas-form-name"]')
      .setValue('Reviewer')
    await wrapper
      .get('[data-testid="personas-form-soul"]')
      .setValue('Be picky')
    await wrapper
      .get('[data-testid="personas-form-identity"]')
      .setValue('A reviewer.')
    await wrapper
      .get('[data-testid="personas-form-agents"]')
      .setValue('review code')

    // Second load returns both personas now.
    mockInitialLoad([
      defaultPersona,
      persona({
        id: 2,
        name: 'Reviewer',
        soul: 'Be picky',
        identity: 'A reviewer.',
        agents: 'review code',
      }),
    ])

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/personas', {
      name: 'Reviewer',
      soul: 'Be picky',
      identity: 'A reviewer.',
      agents: 'review code',
      is_default: false,
    })
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-2"]').exists(),
      ).toBe(true),
    )
  })

  it('submits with only one fragment filled — the empty ones go through as ""', async () => {
    // Plan 36: backend accepts a payload as long as *one* of the three
    // fragments is non-blank. The FE must NOT block this case — it only
    // blocks the all-empty case (separate test below).
    mockInitialLoad()
    apiPost.mockResolvedValueOnce(
      persona({ id: 2, name: 'Soul-only', soul: 'X', identity: '', agents: '' }),
    )
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )
    await wrapper.get('[data-testid="personas-new-button"]').trigger('click')
    await wrapper
      .get('[data-testid="personas-form-name"]')
      .setValue('Soul-only')
    await wrapper.get('[data-testid="personas-form-soul"]').setValue('X')

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/personas', {
      name: 'Soul-only',
      soul: 'X',
      identity: '',
      agents: '',
      is_default: false,
    })
  })

  it('blocks submit + shows PERSONA_FRAGMENTS_ALL_EMPTY when all three fragments are blank', async () => {
    mockInitialLoad()
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="personas-new-button"]').trigger('click')
    await wrapper
      .get('[data-testid="personas-form-name"]')
      .setValue('Empty')
    // intentionally do NOT fill soul/identity/agents

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(apiPost).not.toHaveBeenCalled()
    expect(
      wrapper.get('[data-testid="personas-form-error"]').text(),
    ).toContain('errors.PERSONA_FRAGMENTS_ALL_EMPTY')
  })

  it('renders 409 from create as a PERSONA_NAME_CONFLICT i18n key', async () => {
    mockInitialLoad()
    // Plan 30/36: backend emits `{ detail: { code, params } }` for
    // structured errors. translateError(err, t) walks this envelope and
    // renders `errors.<CODE>`. With the passthrough `t` mock the page
    // falls back to `errors.UNKNOWN (CODE)`, so we just assert the code
    // string is present somewhere in the form-error block.
    apiPost.mockRejectedValueOnce({
      status: 409,
      data: {
        detail: { code: 'PERSONA_NAME_CONFLICT', params: { name: 'Hermes' } },
      },
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="personas-new-button"]').trigger('click')
    await wrapper
      .get('[data-testid="personas-form-name"]')
      .setValue('Hermes')
    await wrapper
      .get('[data-testid="personas-form-soul"]')
      .setValue('x')

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="personas-form-error"]').text(),
    ).toContain('PERSONA_NAME_CONFLICT')
  })

  it('opens the edit form prefilled with the persona fragments', async () => {
    const target = persona({
      id: 1,
      name: 'Hermes',
      soul: 'soul X',
      identity: 'identity Y',
      agents: 'agents Z',
      is_default: true,
    })
    mockInitialLoad([target])
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="persona-edit-1"]').trigger('click')

    // Edit-form should now be visible, prefilled with the persona's
    // current fragments.
    expect(
      wrapper.find('[data-testid="personas-edit-form"]').exists(),
    ).toBe(true)
    const soul = wrapper.get(
      '[data-testid="personas-form-soul"]',
    ).element as HTMLTextAreaElement
    const identity = wrapper.get(
      '[data-testid="personas-form-identity"]',
    ).element as HTMLTextAreaElement
    const agents = wrapper.get(
      '[data-testid="personas-form-agents"]',
    ).element as HTMLTextAreaElement
    expect(soul.value).toBe('soul X')
    expect(identity.value).toBe('identity Y')
    expect(agents.value).toBe('agents Z')
  })

  it('updates a persona via the edit form with all three fragments', async () => {
    const target = persona({
      id: 1,
      name: 'Hermes',
      soul: 'soul old',
      identity: 'identity old',
      agents: 'agents old',
      is_default: true,
    })
    mockInitialLoad([target])
    apiPut.mockResolvedValueOnce({
      ...target,
      soul: 'soul new',
      identity: 'identity new',
      agents: 'agents new',
    })
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="persona-edit-1"]').trigger('click')
    await wrapper
      .get('[data-testid="personas-form-soul"]')
      .setValue('soul new')
    await wrapper
      .get('[data-testid="personas-form-identity"]')
      .setValue('identity new')
    await wrapper
      .get('[data-testid="personas-form-agents"]')
      .setValue('agents new')

    mockInitialLoad([
      {
        ...target,
        soul: 'soul new',
        identity: 'identity new',
        agents: 'agents new',
      },
    ])
    await wrapper.get('[data-testid="personas-edit-form"]').trigger('submit')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/personas/1', {
      name: 'Hermes',
      soul: 'soul new',
      identity: 'identity new',
      agents: 'agents new',
      is_default: true,
    })
  })

  // ── Plan 36 (Wave A1): persona-history subview ─────────────────────

  it('does not call /history before the user opens the toggle', async () => {
    mockInitialLoad()
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    // Block exists but it's a closed <details>.
    expect(
      wrapper.find('[data-testid="persona-history-block-1"]').exists(),
    ).toBe(true)
    expect(apiGet).not.toHaveBeenCalledWith('/api/personas/1/history', undefined)
  })

  it('loads + renders the per-persona history list on toggle open', async () => {
    mockInitialLoad()
    const entries = [
      historyEntry({
        id: 11,
        persona_id: 1,
        author: 'user',
        snapshot: { soul: 's1', identity: 'i1', agents: 'a1' },
      }),
      historyEntry({
        id: 12,
        persona_id: 1,
        author: 'agent',
        snapshot: { soul: 's0', identity: 'i0', agents: 'a0' },
      }),
    ]
    const historyResp: PersonaHistoryListResponse = { history: entries }
    // Layer the history GET on top of the initial mock.
    const prev = apiGet.getMockImplementation()
    apiGet.mockImplementation((path: string, query?: unknown) => {
      if (path === '/api/personas/1/history') {
        return Promise.resolve(historyResp)
      }
      return prev!(path, query)
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    // Native <details> doesn't toggle on click in jsdom — flip `open`
    // imperatively, then dispatch `toggle` so the @toggle handler fires.
    const details = wrapper.get(
      '[data-testid="persona-history-block-1"]',
    ).element as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/personas/1/history', undefined)
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="persona-history-entry-1-11"]').exists(),
      ).toBe(true)
      expect(
        wrapper.find('[data-testid="persona-history-entry-1-12"]').exists(),
      ).toBe(true)
    })
    const row = wrapper.get('[data-testid="persona-history-entry-1-11"]')
    expect(row.text()).toContain('user')
    expect(row.text()).toContain('s1')
    expect(row.text()).toContain('i1')
    expect(row.text()).toContain('a1')
  })

  it('shows the history empty-state when the list is empty', async () => {
    mockInitialLoad()
    const prev = apiGet.getMockImplementation()
    apiGet.mockImplementation((path: string, query?: unknown) => {
      if (path === '/api/personas/1/history') {
        return Promise.resolve({ history: [] } satisfies PersonaHistoryListResponse)
      }
      return prev!(path, query)
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )
    const details = wrapper.get(
      '[data-testid="persona-history-block-1"]',
    ).element as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()

    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="persona-history-empty-1"]').exists(),
      ).toBe(true)
    })
  })

  it('caches the history list across re-opens of the same <details>', async () => {
    mockInitialLoad()
    const entry = historyEntry({ id: 21, persona_id: 1 })
    const prev = apiGet.getMockImplementation()
    apiGet.mockImplementation((path: string, query?: unknown) => {
      if (path === '/api/personas/1/history') {
        return Promise.resolve({
          history: [entry],
        } satisfies PersonaHistoryListResponse)
      }
      return prev!(path, query)
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    const details = wrapper.get(
      '[data-testid="persona-history-block-1"]',
    ).element as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-history-entry-1-21"]').exists(),
      ).toBe(true),
    )

    const historyCalls = () =>
      apiGet.mock.calls.filter((c) => c[0] === '/api/personas/1/history')
        .length
    expect(historyCalls()).toBe(1)

    // Close + re-open. The cached list keeps rendering and we do NOT
    // re-fetch.
    details.open = false
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()
    expect(historyCalls()).toBe(1)
  })

  it('restores a snapshot: confirm → POST → reload + history refetch', async () => {
    mockInitialLoad()
    const entry = historyEntry({
      id: 31,
      persona_id: 1,
      author: 'user',
      snapshot: { soul: 'old', identity: 'old', agents: 'old' },
    })
    let historyCallCount = 0
    const prev = apiGet.getMockImplementation()
    apiGet.mockImplementation((path: string, query?: unknown) => {
      if (path === '/api/personas/1/history') {
        historyCallCount += 1
        return Promise.resolve({
          history: [entry],
        } satisfies PersonaHistoryListResponse)
      }
      return prev!(path, query)
    })
    apiPost.mockResolvedValueOnce({
      ...defaultPersona,
      soul: 'old',
      identity: 'old',
      agents: 'old',
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    const details = wrapper.get(
      '[data-testid="persona-history-block-1"]',
    ).element as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-history-restore-1-31"]').exists(),
      ).toBe(true),
    )
    expect(historyCallCount).toBe(1)

    // confirmFn.mockResolvedValue(true) is set in beforeEach.
    const personaCallsBefore = apiGet.mock.calls.filter(
      (c) => c[0] === '/api/personas',
    ).length

    await wrapper
      .get('[data-testid="persona-history-restore-1-31"]')
      .trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith(
      '/api/personas/1/history/31/restore',
      undefined,
    )
    // Reload happened: load() re-fetched /api/personas.
    const personaCallsAfter = apiGet.mock.calls.filter(
      (c) => c[0] === '/api/personas',
    ).length
    expect(personaCallsAfter).toBeGreaterThan(personaCallsBefore)
    // History was also refreshed after the restore (the restore itself
    // appends a new snapshot row, so the cached list is stale).
    expect(historyCallCount).toBe(2)
  })

  it('does not POST when the restore-confirm dialog is cancelled', async () => {
    mockInitialLoad()
    const entry = historyEntry({ id: 41, persona_id: 1 })
    const prev = apiGet.getMockImplementation()
    apiGet.mockImplementation((path: string, query?: unknown) => {
      if (path === '/api/personas/1/history') {
        return Promise.resolve({
          history: [entry],
        } satisfies PersonaHistoryListResponse)
      }
      return prev!(path, query)
    })
    confirmFn.mockReset()
    confirmFn.mockResolvedValue(false)

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )
    const details = wrapper.get(
      '[data-testid="persona-history-block-1"]',
    ).element as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await flushPromises()
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-history-restore-1-41"]').exists(),
      ).toBe(true),
    )

    await wrapper
      .get('[data-testid="persona-history-restore-1-41"]')
      .trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(apiPost).not.toHaveBeenCalledWith(
      '/api/personas/1/history/41/restore',
      undefined,
    )
  })

  it('promotes a non-default persona via "Als Default setzen"', async () => {
    const second = persona({ id: 2, name: 'Reviewer' })
    mockInitialLoad([defaultPersona, second])
    apiPut.mockResolvedValueOnce({ ...second, is_default: true })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-set-default-2"]').exists(),
      ).toBe(true),
    )

    // After promotion, the next load shows id=2 as default and id=1 demoted.
    mockInitialLoad([
      { ...defaultPersona, is_default: false },
      { ...second, is_default: true },
    ])

    await wrapper
      .get('[data-testid="persona-set-default-2"]')
      .trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/personas/2', {
      is_default: true,
    })
    await vi.waitFor(() => {
      // Default badge has moved to persona 2.
      const card2 = wrapper.get('[data-testid="persona-card-2"]')
      expect(card2.find('[data-testid="persona-default-badge"]').exists()).toBe(true)
    })
  })

  it('updates a channel persona via the dropdown', async () => {
    mockInitialLoad()
    apiPut.mockResolvedValueOnce({
      ...fourChannels[0],
      default_persona_id: 1,
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="channel-card-web"]').exists(),
      ).toBe(true),
    )

    const select = wrapper.get('[data-testid="channel-persona-select-web"]')
    await select.setValue('1')

    // Reload after save returns the updated channel.
    mockInitialLoad([defaultPersona], [
      { ...fourChannels[0], default_persona_id: 1 },
      ...fourChannels.slice(1),
    ])

    await wrapper.get('[data-testid="channel-save-web"]').trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/channels/web', {
      default_persona_id: 1,
    })
  })

  it('edits a channel prompt and shows the reset button after divergence', async () => {
    mockInitialLoad()
    apiPut.mockResolvedValueOnce({
      ...fourChannels[1],
      prompt: 'Custom task prompt',
      is_default_prompt: false,
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="channel-card-task"]').exists(),
      ).toBe(true),
    )

    await wrapper
      .get('[data-testid="channel-prompt-task"]')
      .setValue('Custom task prompt')

    mockInitialLoad([defaultPersona], [
      fourChannels[0]!,
      {
        ...fourChannels[1]!,
        prompt: 'Custom task prompt',
        is_default_prompt: false,
      },
      fourChannels[2]!,
      fourChannels[3]!,
    ])

    await wrapper.get('[data-testid="channel-save-task"]').trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/channels/task', {
      prompt: 'Custom task prompt',
    })

    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-testid="channel-reset-task"]').exists(),
      ).toBe(true)
      expect(
        wrapper.find('[data-testid="channel-custom-badge-task"]').exists(),
      ).toBe(true)
    })
  })

  it('surfaces a 422 channel error in the per-card error slot', async () => {
    mockInitialLoad()
    apiPut.mockRejectedValueOnce({
      statusCode: 422,
      data: { detail: 'persona 99 does not exist' },
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="channel-card-web"]').exists(),
      ).toBe(true),
    )

    await wrapper
      .get('[data-testid="channel-prompt-web"]')
      .setValue('something custom')

    await wrapper.get('[data-testid="channel-save-web"]').trigger('click')
    await flushPromises()

    const cardError = wrapper.get('[data-testid="channel-error-web"]')
    expect(cardError.text()).toContain('persona 99 does not exist')
    // Page-level error stays empty — only this card's error fires.
    expect(
      wrapper.find('[data-testid="preferences-global-error"]').exists(),
    ).toBe(false)
  })

  it('preserves an in-flight channel prompt draft across a persona reload', async () => {
    // User edits a channel prompt (does NOT save), then clicks "Als
    // Default setzen" on a non-default persona. The trailing load()
    // must NOT wipe the unsaved channel edit.
    const second = persona({ id: 2, name: 'Reviewer' })
    mockInitialLoad([defaultPersona, second])
    apiPut.mockResolvedValueOnce({ ...second, is_default: true })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="channel-card-web"]').exists(),
      ).toBe(true),
    )

    const promptInput = wrapper.get(
      '[data-testid="channel-prompt-web"]',
    ) as ReturnType<typeof wrapper.get>
    await promptInput.setValue('WIP draft — not yet saved')

    // After the promotion the page reloads both lists; channels' content
    // is unchanged from the server side.
    mockInitialLoad([
      { ...defaultPersona, is_default: false },
      { ...second, is_default: true },
    ])

    await wrapper
      .get('[data-testid="persona-set-default-2"]')
      .trigger('click')
    await flushPromises()

    expect(
      (wrapper.get('[data-testid="channel-prompt-web"]')
        .element as HTMLTextAreaElement).value,
    ).toBe('WIP draft — not yet saved')
  })

  it('resets a customised channel prompt back to the default', async () => {
    const customised: ChannelPrompt = {
      ...fourChannels[2]!,
      prompt: 'Custom signal prompt',
      is_default_prompt: false,
    }
    mockInitialLoad([defaultPersona], [
      fourChannels[0]!,
      fourChannels[1]!,
      customised,
      fourChannels[3]!,
    ])
    apiPost.mockResolvedValueOnce({
      ...fourChannels[2]!,
      is_default_prompt: true,
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="channel-reset-signal"]').exists(),
      ).toBe(true),
    )

    mockInitialLoad()  // back to four pristine rows

    await wrapper
      .get('[data-testid="channel-reset-signal"]')
      .trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith(
      '/api/channels/signal/reset',
      undefined,
    )
  })

  // ── Plan 33: Persona-Skill activation per persona card ─────────────

  function mockSkills(
    personas: Persona[],
    catalog: Array<{ id: number; slug: string; name?: string }>,
    perPersona: Record<
      number,
      Array<{
        skillId: number
        slug: string
        name?: string
        enabled?: boolean
      }>
    >,
  ) {
    const personaResp: PersonaListResponse = { personas }
    const channelResp: ChannelPromptListResponse = { channels: fourChannels }
    const personaSkillsRe = /^\/api\/personas\/(\d+)\/skills$/
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/personas') return Promise.resolve(personaResp)
      if (path === '/api/channels') return Promise.resolve(channelResp)
      if (path === '/api/skills') {
        return Promise.resolve({
          skills: catalog.map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name ?? s.slug,
            description: 'desc',
            when_to_use: null,
            body_markdown: 'body',
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
          })),
        })
      }
      const m = personaSkillsRe.exec(path)
      if (m) {
        const personaId = Number(m[1])
        const items = perPersona[personaId] ?? []
        return Promise.resolve({
          skills: items.map((it, idx) => ({
            skill: {
              id: it.skillId,
              slug: it.slug,
              name: it.name ?? it.slug,
              description: 'desc',
              when_to_use: null,
              body_markdown: 'body',
              created_at: 1_700_000_000,
              updated_at: 1_700_000_000,
            },
            ordering: idx,
            enabled: it.enabled ?? true,
          })),
        })
      }
      return Promise.reject(new Error(`unexpected GET ${path}`))
    })
  }

  it('renders the persona-skills empty state when no skills are attached', async () => {
    mockSkills(
      [defaultPersona],
      [{ id: 1, slug: 'a' }],
      { [defaultPersona.id]: [] },
    )
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skills-empty-${defaultPersona.id}"]`)
          .exists(),
      ).toBe(true),
    )
    expect(
      wrapper
        .find(`[data-testid="persona-skill-add-${defaultPersona.id}"]`)
        .exists(),
    ).toBe(true)
  })

  it('lists active skills with toggle, up/down, remove controls', async () => {
    mockSkills(
      [defaultPersona],
      [
        { id: 1, slug: 'a' },
        { id: 2, slug: 'b' },
      ],
      {
        [defaultPersona.id]: [
          { skillId: 1, slug: 'a', enabled: true },
          { skillId: 2, slug: 'b', enabled: false },
        ],
      },
    )
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-${defaultPersona.id}-a"]`)
          .exists(),
      ).toBe(true),
    )
    expect(
      wrapper
        .find(`[data-testid="persona-skill-${defaultPersona.id}-b"]`)
        .exists(),
    ).toBe(true)
  })

  it('adds a skill via the dropdown and persists ordering', async () => {
    mockSkills(
      [defaultPersona],
      [
        { id: 1, slug: 'a' },
        { id: 2, slug: 'b' },
      ],
      { [defaultPersona.id]: [] },
    )
    apiPut.mockResolvedValueOnce({
      skills: [
        {
          skill: {
            id: 1,
            slug: 'a',
            name: 'a',
            description: 'd',
            when_to_use: null,
            body_markdown: 'b',
            created_at: 1,
            updated_at: 1,
          },
          ordering: 0,
          enabled: true,
        },
      ],
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-add-${defaultPersona.id}"]`)
          .exists(),
      ).toBe(true),
    )

    const select = wrapper.get(
      `[data-testid="persona-skill-add-${defaultPersona.id}"]`,
    )
    await select.setValue('1')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith(
      `/api/personas/${defaultPersona.id}/skills`,
      {
        items: [
          { skill_id: 1, ordering: 0, enabled: true },
        ],
      },
    )
  })

  it('toggles enabled state via the checkbox', async () => {
    mockSkills(
      [defaultPersona],
      [{ id: 1, slug: 'a' }],
      {
        [defaultPersona.id]: [
          { skillId: 1, slug: 'a', enabled: true },
        ],
      },
    )
    apiPut.mockResolvedValueOnce({
      skills: [
        {
          skill: {
            id: 1,
            slug: 'a',
            name: 'a',
            description: 'd',
            when_to_use: null,
            body_markdown: 'b',
            created_at: 1,
            updated_at: 1,
          },
          ordering: 0,
          enabled: false,
        },
      ],
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-toggle-${defaultPersona.id}-a"]`)
          .exists(),
      ).toBe(true),
    )

    await wrapper
      .get(`[data-testid="persona-skill-toggle-${defaultPersona.id}-a"]`)
      .trigger('change')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith(
      `/api/personas/${defaultPersona.id}/skills`,
      {
        items: [{ skill_id: 1, ordering: 0, enabled: false }],
      },
    )
  })

  it('reorders a skill via the up/down buttons', async () => {
    mockSkills(
      [defaultPersona],
      [
        { id: 1, slug: 'a' },
        { id: 2, slug: 'b' },
      ],
      {
        [defaultPersona.id]: [
          { skillId: 1, slug: 'a' },
          { skillId: 2, slug: 'b' },
        ],
      },
    )
    apiPut.mockResolvedValueOnce({ skills: [] })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-down-${defaultPersona.id}-a"]`)
          .exists(),
      ).toBe(true),
    )

    await wrapper
      .get(`[data-testid="persona-skill-down-${defaultPersona.id}-a"]`)
      .trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith(
      `/api/personas/${defaultPersona.id}/skills`,
      {
        items: [
          { skill_id: 2, ordering: 0, enabled: true },
          { skill_id: 1, ordering: 1, enabled: true },
        ],
      },
    )
  })

  it('keeps the persona-skill list untouched after a failed PUT', async () => {
    // Pessimistic update contract: a 422 from the backend must NOT
    // leave the UI showing the would-be new list. We verify by toggling
    // an active skill and asserting it's still rendered as enabled after
    // the failure.
    mockSkills(
      [defaultPersona],
      [{ id: 1, slug: 'a' }],
      {
        [defaultPersona.id]: [
          { skillId: 1, slug: 'a', enabled: true },
        ],
      },
    )
    apiPut.mockRejectedValueOnce({
      statusCode: 422,
      data: { detail: 'simulated failure' },
    })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-toggle-${defaultPersona.id}-a"]`)
          .exists(),
      ).toBe(true),
    )

    const checkbox = wrapper.get(
      `[data-testid="persona-skill-toggle-${defaultPersona.id}-a"]`,
    )
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)

    await checkbox.trigger('change')
    await flushPromises()

    // After the failed PUT the checkbox must still reflect the prior
    // server state (enabled=true), because we did not optimistically
    // mutate before the await resolved.
    const afterCheckbox = wrapper.get(
      `[data-testid="persona-skill-toggle-${defaultPersona.id}-a"]`,
    )
    expect((afterCheckbox.element as HTMLInputElement).checked).toBe(true)
  })

  it('removes a skill from the persona', async () => {
    mockSkills(
      [defaultPersona],
      [{ id: 1, slug: 'a' }],
      {
        [defaultPersona.id]: [{ skillId: 1, slug: 'a' }],
      },
    )
    apiPut.mockResolvedValueOnce({ skills: [] })

    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper
          .find(`[data-testid="persona-skill-remove-${defaultPersona.id}-a"]`)
          .exists(),
      ).toBe(true),
    )

    await wrapper
      .get(`[data-testid="persona-skill-remove-${defaultPersona.id}-a"]`)
      .trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith(
      `/api/personas/${defaultPersona.id}/skills`,
      { items: [] },
    )
  })

  // ── Plan 30 Wave 0: Sprach-Picker section ─────────────────────────

  it('renders the language picker section with DE selected by default', async () => {
    mockInitialLoad()
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    const select = wrapper.get(
      '[data-testid="language-select"]',
    ) as ReturnType<typeof wrapper.get>
    expect((select.element as HTMLSelectElement).value).toBe('de')
  })

  it('calls setLocale when the language picker changes', async () => {
    mockInitialLoad()
    const wrapper = mount(PreferencesPage)
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-1"]').exists(),
      ).toBe(true),
    )

    await wrapper.get('[data-testid="language-select"]').setValue('en')
    await flushPromises()

    expect(setLocaleMock).toHaveBeenCalledWith('en')
  })
})
