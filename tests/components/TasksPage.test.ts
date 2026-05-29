import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TasksPage from '~/pages/settings/tasks.vue'
import type { AgentTask } from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    patch: (path: string, body?: unknown) => apiPatch(path, body),
    put: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

function task(overrides: Partial<AgentTask> & { id: number; title: string }): AgentTask {
  return {
    id: overrides.id,
    title: overrides.title,
    prompt: overrides.prompt ?? 'do the thing',
    due_at: overrides.due_at ?? 2_000_000_000,
    schedule: overrides.schedule ?? null,
    timezone: overrides.timezone ?? 'UTC',
    enabled: overrides.enabled ?? true,
    last_run_at: overrides.last_run_at ?? null,
    last_status: overrides.last_status ?? null,
    last_run_id: overrides.last_run_id ?? null,
    created_at: overrides.created_at ?? 1_700_000_000,
    updated_at: overrides.updated_at ?? 1_700_000_000,
  }
}

describe('settings/tasks.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPatch.mockReset()
    apiDelete.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty-state when there are no tasks', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(TasksPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/tasks', undefined)
    expect(wrapper.text()).toContain('Noch keine Tasks')
    expect(wrapper.text()).toContain('Wähle einen Task')
  })

  it('lists tasks with title + schedule chip', async () => {
    apiGet.mockResolvedValue([
      task({
        id: 1,
        title: 'daily summary',
        schedule: '0 8 * * *',
        timezone: 'UTC',
        due_at: 2_000_000_000,
      }),
      task({ id: 2, title: 'one-shot', due_at: 2_000_000_000 }),
    ])
    const wrapper = mount(TasksPage)
    await flushPromises()

    const item1 = wrapper.get('[data-testid="task-item-1"]')
    expect(item1.text()).toContain('daily summary')
    expect(item1.text()).toContain('0 8 * * *')

    const item2 = wrapper.get('[data-testid="task-item-2"]')
    expect(item2.text()).toContain('one-shot')
  })

  it('selecting a task switches the right pane to read mode', async () => {
    apiGet.mockResolvedValue([
      task({ id: 1, title: 't', prompt: 'hello' }),
    ])
    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="task-detail-title"]').text()).toBe('t')
    expect(wrapper.text()).toContain('hello')
  })

  it('creates a one-shot task via + button and POSTs the body', async () => {
    apiGet.mockResolvedValueOnce([])
    apiPost.mockResolvedValueOnce(task({ id: 9, title: 'wake up' }))
    apiGet.mockResolvedValueOnce([task({ id: 9, title: 'wake up' })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('button[aria-label="Neuer Task"]').trigger('click')
    await wrapper.find('#taskTitle').setValue('wake up')
    await wrapper.find('#taskPrompt').setValue('say good morning')
    // Mode defaults to 'once' on create.
    await wrapper.find('#taskDueAt').setValue('2099-01-01T10:00')

    await wrapper.get('[data-testid="task-save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledTimes(1)
    const [path, body] = apiPost.mock.calls[0]
    expect(path).toBe('/api/tasks')
    expect(body).toMatchObject({
      title: 'wake up',
      prompt: 'say good morning',
      schedule: null,
      enabled: true,
    })
    expect(body.due_at).toBeGreaterThan(0)
  })

  it('switches form to cron mode and sends schedule + clears due_at', async () => {
    apiGet.mockResolvedValueOnce([])
    apiPost.mockResolvedValueOnce(task({ id: 9, title: 'daily', schedule: '0 8 * * *' }))
    apiGet.mockResolvedValueOnce([
      task({ id: 9, title: 'daily', schedule: '0 8 * * *' }),
    ])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('button[aria-label="Neuer Task"]').trigger('click')
    await wrapper.find('#taskTitle').setValue('daily')
    await wrapper.find('#taskPrompt').setValue('summary')

    // Flip to cron mode.
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[1].setValue()
    await flushPromises()

    await wrapper.find('#taskCron').setValue('0 8 * * *')

    await wrapper.get('[data-testid="task-save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledTimes(1)
    const [, body] = apiPost.mock.calls[0]
    expect(body).toMatchObject({
      title: 'daily',
      prompt: 'summary',
      due_at: null,
      schedule: '0 8 * * *',
    })
  })

  it('pauses an enabled task via the toggle button', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', enabled: true })])
    apiPatch.mockResolvedValueOnce(task({ id: 1, title: 't', enabled: false }))
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', enabled: false })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-toggle-enabled"]').trigger('click')
    await flushPromises()

    expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', {
      enabled: false,
      clear_due_at: false,
      clear_schedule: false,
    })
  })

  it('runs a task now via the play button', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    apiPost.mockResolvedValueOnce({ task_id: 1, run_id: '', status: 'queued' })
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', last_status: 'success' })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-run-now"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/1/run', undefined)
  })

  it('deletes a task after confirmation', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    apiDelete.mockResolvedValueOnce(undefined)
    apiGet.mockResolvedValueOnce([])

    // The test environment doesn't ship `window.confirm`, so install a stub
    // we can both call and restore.
    const originalConfirm = window.confirm
    const confirmFn = vi.fn(() => true)
    Object.defineProperty(window, 'confirm', { value: confirmFn, configurable: true })

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-delete"]').trigger('click')
    await flushPromises()

    expect(apiDelete).toHaveBeenCalledWith('/api/tasks/1', undefined)
    expect(confirmFn).toHaveBeenCalled()
    Object.defineProperty(window, 'confirm', {
      value: originalConfirm,
      configurable: true,
    })
  })
})
