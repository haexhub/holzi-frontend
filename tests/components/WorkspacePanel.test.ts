import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WorkspacePanel from '~/components/panels/WorkspacePanel.vue'
import type {
  TreeEntry,
  WorkspaceFileResponse,
  WorkspaceGitResponse,
  WorkspaceRootsResponse,
  WorkspaceTreeResponse,
} from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: (path: string, body?: unknown) => apiPut(path, body),
    patch: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

// Used as a default response for the panel's /api/workspace/git call so
// existing Plan 12 tests don't need to know the endpoint exists. Plan 13
// tests that care about the badge override with `is_repo: true`.
const NOT_A_REPO: WorkspaceGitResponse = {
  root: 'ws',
  is_repo: false,
  branch: null,
  dirty: false,
  entries: [],
}

const stubs = {
  RenderedMarkdown: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div class="rm-stub">{{ content }}</div>',
  },
}

function httpError(status: number, detail?: string): Error & { statusCode: number; data?: { detail?: string } } {
  const err = new Error(detail ?? `HTTP ${status}`) as Error & {
    statusCode: number
    data?: { detail?: string }
  }
  err.statusCode = status
  if (detail) err.data = { detail }
  return err
}

function rootsResponse(ids: string[]): WorkspaceRootsResponse {
  return { roots: ids.map((id) => ({ id })) }
}

function treeResponse(root: string, path: string, entries: TreeEntry[]): WorkspaceTreeResponse {
  return { root, path, entries }
}

function fileResponse(
  overrides: Partial<WorkspaceFileResponse> & { name: string },
): WorkspaceFileResponse {
  return {
    root: overrides.root ?? 'ws',
    path: overrides.path ?? overrides.name,
    name: overrides.name,
    size: overrides.size ?? 12,
    kind: overrides.kind ?? 'text',
    content: overrides.content ?? null,
    data_url: overrides.data_url ?? null,
    truncated: overrides.truncated ?? false,
    sha256: overrides.sha256 ?? null,
  }
}

describe('WorkspacePanel.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty-state when no roots are configured', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse([]))
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('Keine Workspaces konfiguriert')
    expect(wrapper.text()).toContain('HERMES_WORKSPACE_ROOTS')
  })

  it('auto-selects the first root and renders its tree entries', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws-a', 'ws-b']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws-a', '', [
            { name: 'README.md', type: 'file', size: 12 },
            { name: 'src', type: 'dir', size: 0 },
          ]),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('ws-a')
    expect(text).toContain('README.md')
    expect(text).toContain('src')
  })

  it('sorts directories before files alphabetically', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [
            { name: 'zeta.txt', type: 'file', size: 1 },
            { name: 'alpha.txt', type: 'file', size: 1 },
            { name: 'mid', type: 'dir', size: 0 },
            { name: 'aaa', type: 'dir', size: 0 },
          ]),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const items = wrapper.findAll('li').map((li) => li.text())
    const filtered = items.filter((t) => /aaa|mid|alpha\.txt|zeta\.txt/.test(t))
    expect(filtered[0]).toContain('aaa')
    expect(filtered[1]).toContain('mid')
    expect(filtered[2]).toContain('alpha.txt')
    expect(filtered[3]).toContain('zeta.txt')
  })

  it('navigates into a directory and re-fetches /tree with the joined path', async () => {
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree') {
        if (query?.path === '')
          return Promise.resolve(
            treeResponse('ws', '', [{ name: 'src', type: 'dir', size: 0 }]),
          )
        if (query?.path === 'src')
          return Promise.resolve(
            treeResponse('ws', 'src', [{ name: 'main.ts', type: 'file', size: 50 }]),
          )
      }
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path} ${JSON.stringify(query)}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const dirItem = wrapper.findAll('li').find((li) => li.text().includes('src'))
    expect(dirItem).toBeTruthy()
    await dirItem!.trigger('click')
    await flushPromises()
    const treeCalls = apiGet.mock.calls.filter((c) => c[0] === '/api/workspace/tree')
    expect(treeCalls.length).toBe(2)
    expect(treeCalls[1]![1]).toEqual({ root: 'ws', path: 'src' })
    expect(wrapper.text()).toContain('main.ts')
  })

  it('selecting a file fetches /file and renders text content in a <pre>', async () => {
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'a.txt', type: 'file', size: 5 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({ name: 'a.txt', kind: 'text', content: 'hello world' }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path} ${JSON.stringify(query)}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const fileItem = wrapper.findAll('li').find((li) => li.text().includes('a.txt'))
    await fileItem!.trigger('click')
    await flushPromises()
    const fileCalls = apiGet.mock.calls.filter((c) => c[0] === '/api/workspace/file')
    expect(fileCalls.length).toBe(1)
    expect(fileCalls[0]![1]).toEqual({ root: 'ws', path: 'a.txt' })
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    expect(pre.text()).toBe('hello world')
  })

  it('markdown kind routes through RenderedMarkdown', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'README.md', type: 'file', size: 5 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({ name: 'README.md', kind: 'markdown', content: '# Hi' }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const item = wrapper.findAll('li').find((li) => li.text().includes('README.md'))
    await item!.trigger('click')
    await flushPromises()
    const stub = wrapper.find('.rm-stub')
    expect(stub.exists()).toBe(true)
    expect(stub.text()).toBe('# Hi')
  })

  it('image kind renders an <img> with the data_url as src', async () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'logo.png', type: 'file', size: 999 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({ name: 'logo.png', kind: 'image', data_url: dataUrl }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const item = wrapper.findAll('li').find((li) => li.text().includes('logo.png'))
    await item!.trigger('click')
    await flushPromises()
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe(dataUrl)
  })

  it('binary kind renders the metadata-only message and no <pre> or <img>', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'app.bin', type: 'file', size: 999 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({ name: 'app.bin', kind: 'binary', size: 999 }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const item = wrapper.findAll('li').find((li) => li.text().includes('app.bin'))
    await item!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Vorschau nicht verfügbar (Binärdatei)')
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('shows the "Vorschau gekürzt" banner when truncated is true', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'big.txt', type: 'file', size: 999999 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({
            name: 'big.txt',
            kind: 'text',
            content: 'partial...',
            truncated: true,
          }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const item = wrapper.findAll('li').find((li) => li.text().includes('big.txt'))
    await item!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Vorschau gekürzt')
  })

  it('shows "Workspace nicht verfügbar" when /tree returns 503', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree') return Promise.reject(httpError(503))
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('Workspace nicht verfügbar')
  })

  it('shows "Pfad nicht gefunden" on a 404 but the breadcrumb is still navigable', async () => {
    let serveError = true
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree') {
        if (serveError && query?.path === 'missing') return Promise.reject(httpError(404))
        return Promise.resolve(
          treeResponse('ws', String(query?.path ?? ''), [
            { name: 'missing', type: 'dir', size: 0 },
          ]),
        )
      }
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const dirItem = wrapper.findAll('li').find((li) => li.text().includes('missing'))
    await dirItem!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Pfad nicht gefunden')
    // Breadcrumb back to root still works.
    serveError = false
    const rootCrumb = wrapper.findAll('button').find((b) => b.text() === 'ws')
    expect(rootCrumb).toBeTruthy()
    await rootCrumb!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Pfad nicht gefunden')
    expect(wrapper.text()).toContain('missing')
  })

  it('shows "Workspace nicht verfügbar" when /file returns 503 (sandbox crashed)', async () => {
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree') {
        return Promise.resolve(
          treeResponse('ws', String(query?.path ?? ''), [
            { name: 'a.txt', type: 'file', size: 4 },
          ]),
        )
      }
      if (path === '/api/workspace/file') return Promise.reject(httpError(503))
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const file = wrapper.findAll('li').find((li) => li.text().includes('a.txt'))
    await file!.trigger('click')
    await flushPromises()
    // The preview region (aria-live) shows the 503 copy.
    expect(wrapper.text()).toContain('Workspace nicht verfügbar')
  })

  it('refresh button re-fetches tree and current file preview', async () => {
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree') {
        return Promise.resolve(
          treeResponse('ws', String(query?.path ?? ''), [
            { name: 'note.txt', type: 'file', size: 5 },
          ]),
        )
      }
      if (path === '/api/workspace/file') {
        return Promise.resolve(
          fileResponse({ name: 'note.txt', content: 'hello', kind: 'text', size: 5 }),
        )
      }
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    const file = wrapper.findAll('li').find((li) => li.text().includes('note.txt'))
    await file!.trigger('click')
    await flushPromises()

    apiGet.mockClear()
    const refresh = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Aktualisieren')
    expect(refresh).toBeTruthy()
    await refresh!.trigger('click')
    await flushPromises()

    const calls = apiGet.mock.calls.map((c) => c[0] as string)
    expect(calls).toContain('/api/workspace/tree')
    expect(calls).toContain('/api/workspace/file')
  })

  it('stale tree response from a previous root does not overwrite the current root', async () => {
    // Two roots; the first root's tree fetch is held open by a deferred
    // promise. The user switches roots mid-flight; only the second root's
    // entries should end up in the DOM.
    let resolveSlow: ((v: WorkspaceTreeResponse) => void) | null = null
    const slowTree = new Promise<WorkspaceTreeResponse>((resolve) => {
      resolveSlow = resolve
    })
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') {
        return Promise.resolve(rootsResponse(['slow', 'fast']))
      }
      if (path === '/api/workspace/tree') {
        if (query?.root === 'slow') return slowTree
        return Promise.resolve(
          treeResponse('fast', '', [{ name: 'fast.txt', type: 'file', size: 9 }]),
        )
      }
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    // Slow root is selected first; its fetch is pending.
    expect(wrapper.text()).not.toContain('fast.txt')

    const select = wrapper.find('select')
    await select.setValue('fast')
    await flushPromises()
    expect(wrapper.text()).toContain('fast.txt')

    // Resolve the stale slow response — it must NOT replace the fast entries.
    resolveSlow!(treeResponse('slow', '', [{ name: 'slow.txt', type: 'file', size: 1 }]))
    await flushPromises()
    expect(wrapper.text()).toContain('fast.txt')
    expect(wrapper.text()).not.toContain('slow.txt')
  })

  // --- Plan 13: git badge --------------------------------------------------

  it('renders branch + dirty badge when /api/workspace/git reports a dirty repo', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(treeResponse('ws', '', []))
      if (path === '/api/workspace/git')
        return Promise.resolve({
          root: 'ws',
          is_repo: true,
          branch: 'main',
          dirty: true,
          entries: [{ status: ' M', path: 'src/foo.py' }],
        } satisfies WorkspaceGitResponse)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('main')
    expect(wrapper.text()).toContain('dirty')
  })

  it('shows the clean indicator when /api/workspace/git reports no changes', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(treeResponse('ws', '', []))
      if (path === '/api/workspace/git')
        return Promise.resolve({
          root: 'ws',
          is_repo: true,
          branch: 'feature/x',
          dirty: false,
          entries: [],
        } satisfies WorkspaceGitResponse)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('feature/x')
    expect(wrapper.text()).toContain('clean')
  })

  // --- Plan 13: edit + save ------------------------------------------------

  it('hides the Edit button when no conversation is selected', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'a.txt', type: 'file', size: 5 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({
            name: 'a.txt',
            kind: 'text',
            content: 'hi',
            sha256: 'deadbeef',
          }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    const wrapper = mount(WorkspacePanel, {
      global: { stubs },
      props: { conversationId: null },
    })
    await flushPromises()
    const file = wrapper.findAll('li').find((li) => li.text().includes('a.txt'))
    await file!.trigger('click')
    await flushPromises()
    const edit = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Bearbeiten')
    expect(edit).toBeFalsy()
    expect(wrapper.text()).toContain('Wähle eine Konversation')
  })

  it('save: PUT /api/workspace/file with base_sha and conversation_id, refresh on success', async () => {
    const original = fileResponse({
      name: 'a.txt',
      kind: 'text',
      content: 'old',
      sha256: 'sha-original',
    })
    const updated = fileResponse({
      name: 'a.txt',
      kind: 'text',
      content: 'new',
      sha256: 'sha-updated',
    })
    let nextFile = original
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'a.txt', type: 'file', size: 3 }]),
        )
      if (path === '/api/workspace/file') return Promise.resolve(nextFile)
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    apiPut.mockResolvedValue({
      root: 'ws',
      path: 'a.txt',
      sha256: 'sha-updated',
      committed: true,
    })

    const wrapper = mount(WorkspacePanel, {
      global: { stubs },
      props: { conversationId: 42 },
    })
    await flushPromises()
    const file = wrapper.findAll('li').find((li) => li.text().includes('a.txt'))
    await file!.trigger('click')
    await flushPromises()

    // Enter edit mode.
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Bearbeiten')
    expect(editBtn).toBeTruthy()
    await editBtn!.trigger('click')
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('new')

    // Click Save.
    nextFile = updated
    const saveBtn = wrapper.findAll('button').find((b) => b.text().match(/Speichern/))
    expect(saveBtn).toBeTruthy()
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/workspace/file', {
      root: 'ws',
      path: 'a.txt',
      content: 'new',
      base_sha: 'sha-original',
      conversation_id: '42',
    })
    // After save the panel re-fetched the preview and exited edit mode.
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('new')
  })

  it('save: 409 base_sha mismatch surfaces a conflict message', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(
          treeResponse('ws', '', [{ name: 'a.txt', type: 'file', size: 3 }]),
        )
      if (path === '/api/workspace/file')
        return Promise.resolve(
          fileResponse({
            name: 'a.txt',
            kind: 'text',
            content: 'old',
            sha256: 'sha-stale',
          }),
        )
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    apiPut.mockRejectedValue(httpError(409, 'base_sha mismatch; file changed on disk'))

    const wrapper = mount(WorkspacePanel, {
      global: { stubs },
      props: { conversationId: 1 },
    })
    await flushPromises()
    await wrapper.findAll('li').find((li) => li.text().includes('a.txt'))!.trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Bearbeiten')!
      .trigger('click')
    await wrapper.find('textarea').setValue('new')
    await wrapper.findAll('button').find((b) => b.text().match(/Speichern/))!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Konflikt')
    // Still in edit mode so the user can recover.
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  // --- Plan 13: create -----------------------------------------------------

  it('create: POST /api/workspace/file with empty content and conversation_id, then refresh tree', async () => {
    apiGet.mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
      if (path === '/api/workspace/tree')
        return Promise.resolve(treeResponse('ws', String(query?.path ?? ''), []))
      if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
      throw new Error(`unexpected ${path}`)
    })
    apiPost.mockResolvedValue({
      root: 'ws',
      path: 'new.py',
      sha256: 'sha-new',
      committed: false,
    })

    const wrapper = mount(WorkspacePanel, {
      global: { stubs },
      props: { conversationId: 7 },
    })
    await flushPromises()
    const newBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Neue Datei')
    expect(newBtn).toBeTruthy()
    await newBtn!.trigger('click')
    const input = wrapper.find('input[type="text"]')
    expect(input.exists()).toBe(true)
    await input.setValue('new.py')
    const create = wrapper.findAll('button').find((b) => b.text() === 'Anlegen')
    await create!.trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/workspace/file', {
      root: 'ws',
      path: 'new.py',
      content: '',
      conversation_id: '7',
    })
  })

  // --- Plan 13: delete -----------------------------------------------------

  it('delete: confirms then DELETEs /api/workspace/file with conversation_id', async () => {
    const confirmSpy = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmSpy)
    try {
      apiGet.mockImplementation((path: string) => {
        if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
        if (path === '/api/workspace/tree')
          return Promise.resolve(
            treeResponse('ws', '', [{ name: 'gone.txt', type: 'file', size: 4 }]),
          )
        if (path === '/api/workspace/file')
          return Promise.resolve(
            fileResponse({
              name: 'gone.txt',
              kind: 'text',
              content: 'bye',
              sha256: 'sha-x',
            }),
          )
        if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
        throw new Error(`unexpected ${path}`)
      })
      apiDelete.mockResolvedValue({
        root: 'ws',
        path: 'gone.txt',
        sha256: 'sha-empty',
        committed: false,
      })

      const wrapper = mount(WorkspacePanel, {
        global: { stubs },
        props: { conversationId: 9 },
      })
      await flushPromises()
      await wrapper.findAll('li').find((li) => li.text().includes('gone.txt'))!.trigger('click')
      await flushPromises()
      const delBtn = wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Löschen')
      expect(delBtn).toBeTruthy()
      await delBtn!.trigger('click')
      await flushPromises()

      expect(confirmSpy).toHaveBeenCalled()
      expect(apiDelete).toHaveBeenCalledWith('/api/workspace/file', {
        root: 'ws',
        path: 'gone.txt',
        conversation_id: '9',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('delete: cancelling the confirm dialog does not call the API', async () => {
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    try {
      apiGet.mockImplementation((path: string) => {
        if (path === '/api/workspace/roots') return Promise.resolve(rootsResponse(['ws']))
        if (path === '/api/workspace/tree')
          return Promise.resolve(
            treeResponse('ws', '', [{ name: 'gone.txt', type: 'file', size: 4 }]),
          )
        if (path === '/api/workspace/file')
          return Promise.resolve(
            fileResponse({
              name: 'gone.txt',
              kind: 'text',
              content: 'bye',
              sha256: 'sha-x',
            }),
          )
        if (path === '/api/workspace/git') return Promise.resolve(NOT_A_REPO)
        throw new Error(`unexpected ${path}`)
      })

      const wrapper = mount(WorkspacePanel, {
        global: { stubs },
        props: { conversationId: 1 },
      })
      await flushPromises()
      await wrapper.findAll('li').find((li) => li.text().includes('gone.txt'))!.trigger('click')
      await flushPromises()
      await wrapper
        .findAll('button')
        .find((b) => b.attributes('aria-label') === 'Löschen')!
        .trigger('click')
      await flushPromises()

      expect(confirmSpy).toHaveBeenCalled()
      expect(apiDelete).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
