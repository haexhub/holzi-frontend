import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PreferencesPage from '~/pages/settings/preferences.vue'
import type {
  ChannelPrompt,
  ChannelPromptListResponse,
  Persona,
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

function persona(over: Partial<Persona> & { id: number; name: string }): Persona {
  return {
    id: over.id,
    name: over.name,
    prompt: over.prompt ?? 'p',
    is_default: over.is_default ?? false,
    created_at: over.created_at ?? 1_700_000_000,
    updated_at: over.updated_at ?? 1_700_000_000,
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
  prompt: 'Default Hermes prompt',
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
      persona({ id: 2, name: 'Reviewer', prompt: 'Be picky' }),
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
      .get('[data-testid="personas-form-prompt"]')
      .setValue('Be picky')

    // Second load returns both personas now.
    mockInitialLoad([
      defaultPersona,
      persona({ id: 2, name: 'Reviewer', prompt: 'Be picky' }),
    ])

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/personas', {
      name: 'Reviewer',
      prompt: 'Be picky',
      is_default: false,
    })
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="persona-card-2"]').exists(),
      ).toBe(true),
    )
  })

  it('renders 409 from create as a German duplicate-name message', async () => {
    mockInitialLoad()
    apiPost.mockRejectedValueOnce({ statusCode: 409, message: 'conflict' })

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
      .get('[data-testid="personas-form-prompt"]')
      .setValue('x')

    await wrapper.get('[data-testid="personas-create-form"]').trigger('submit')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="personas-form-error"]').text(),
    ).toContain('Name bereits vergeben')
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
      expect(card2.html()).toContain('Default')
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
})
