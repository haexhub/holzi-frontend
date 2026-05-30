import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WorkspaceGitTab from '~/components/panels/WorkspaceGitTab.vue'
import type {
  GitBranchesResponse,
  GitDiffResponse,
  GitOpResponse,
  GitPullResponse,
  WorkspaceGitResponse,
} from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

const promptFn = vi.fn()
vi.mock('~/composables/usePromptDialog', () => ({
  usePromptDialog: () => ({ prompt: (opts: unknown) => promptFn(opts) }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

const stubs = {
  RenderedMarkdown: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div class="rm-stub">{{ content }}</div>',
  },
}

function httpError(status: number, detail?: string) {
  const err = new Error(detail ?? `HTTP ${status}`) as Error & {
    statusCode: number
    data?: { detail?: string }
  }
  err.statusCode = status
  if (detail) err.data = { detail }
  return err
}

// Default `/api/workspace/git` response — pre-set entries cover both groups
// so the status section renders a representative split.
function statusOk(): WorkspaceGitResponse {
  return {
    root: 'ws',
    is_repo: true,
    branch: 'main',
    dirty: true,
    entries: [
      { status: ' M', path: 'src/x.py' },     // unstaged modify
      { status: 'A ', path: 'docs/new.md' },  // staged add
      { status: '??', path: 'tmp.txt' },      // untracked
    ],
  }
}

function branchesOk(): GitBranchesResponse {
  return {
    current: 'main',
    all: [
      { name: 'main', is_remote: false, last_commit_at: '2026-05-30T10:00:00+02:00' },
      { name: 'feature/x', is_remote: false, last_commit_at: '2026-05-29T08:00:00+02:00' },
      { name: 'origin/main', is_remote: true, last_commit_at: '2026-05-30T09:55:00+02:00' },
    ],
  }
}

function diffText(): GitDiffResponse {
  return {
    kind: 'text',
    patch: '@@ -1 +1 @@\n-old\n+new\n',
    summary: { files: 1, insertions: 1, deletions: 1 },
    truncated: false,
  }
}

function gitOk(): GitOpResponse {
  return { ok: true, message: '' }
}

function wireDefaults() {
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/workspace/git') return Promise.resolve(statusOk())
    if (path === '/api/workspace/git/branches') return Promise.resolve(branchesOk())
    if (path === '/api/workspace/git/diff') return Promise.resolve(diffText())
    throw new Error(`unexpected GET ${path}`)
  })
}

describe('WorkspaceGitTab.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    promptFn.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    toastWarning.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders Staged / Unstaged groups from the porcelain status', async () => {
    wireDefaults()
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Unstaged')
    expect(text).toContain('Staged')
    expect(text).toContain('src/x.py')   // unstaged modify
    expect(text).toContain('tmp.txt')    // untracked → unstaged
    expect(text).toContain('docs/new.md') // staged
  })

  it('Stage button POSTs /git/stage with the row path', async () => {
    wireDefaults()
    apiPost.mockResolvedValue(gitOk())
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()
    const stageBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Stage')
    expect(stageBtn).toBeTruthy()
    await stageBtn!.trigger('click')
    await flushPromises()
    expect(apiPost).toHaveBeenCalledWith('/api/workspace/git/stage', {
      root: 'ws',
      paths: ['src/x.py'],
    })
  })

  it('Unstage button POSTs /git/unstage with the row path', async () => {
    wireDefaults()
    apiPost.mockResolvedValue(gitOk())
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()
    const unstageBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Unstage')
    expect(unstageBtn).toBeTruthy()
    await unstageBtn!.trigger('click')
    await flushPromises()
    expect(apiPost).toHaveBeenCalledWith('/api/workspace/git/unstage', {
      root: 'ws',
      paths: ['docs/new.md'],
    })
  })

  it('selecting a file refetches /git/diff with path + staged flag', async () => {
    wireDefaults()
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()
    apiGet.mockClear()

    // Click the path button inside the staged row → side = 'staged'.
    const stagedRowPathBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'docs/new.md')
    expect(stagedRowPathBtn).toBeTruthy()
    await stagedRowPathBtn!.trigger('click')
    await flushPromises()
    const diffCalls = apiGet.mock.calls.filter((c) => c[0] === '/api/workspace/git/diff')
    expect(diffCalls.length).toBeGreaterThanOrEqual(1)
    expect(diffCalls.at(-1)![1]).toEqual({
      root: 'ws',
      staged: true,
      path: 'docs/new.md',
    })
  })

  it('diff body renders via RenderedMarkdown inside a ```diff fence', async () => {
    wireDefaults()
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()
    const stub = wrapper.find('.rm-stub')
    expect(stub.exists()).toBe(true)
    expect(stub.text()).toContain('```diff')
    expect(stub.text()).toContain('@@ -1 +1 @@')
  })

  it('commit button is disabled until staged + message present, then POSTs /git/commit', async () => {
    wireDefaults()
    apiPost.mockResolvedValue(gitOk())
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 42 },
    })
    await flushPromises()

    const commitBtn = wrapper.findAll('button').find((b) => b.text().startsWith('Commit'))
    expect(commitBtn).toBeTruthy()
    // Message empty → disabled.
    expect(commitBtn!.attributes('disabled')).toBeDefined()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('feat: thing')
    expect(commitBtn!.attributes('disabled')).toBeUndefined()

    await commitBtn!.trigger('click')
    await flushPromises()
    expect(apiPost).toHaveBeenCalledWith('/api/workspace/git/commit', {
      root: 'ws',
      message: 'feat: thing',
      conversation_id: '42',
      all: false,
    })
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('dirty-checkout 409 surfaces the recovery hint via toast.error', async () => {
    wireDefaults()
    apiPost.mockImplementation((path: string) => {
      if (path === '/api/workspace/git/checkout') {
        return Promise.reject(httpError(409, 'working tree has uncommitted changes'))
      }
      throw new Error(`unexpected POST ${path}`)
    })
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('feature/x')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/workspace/git/checkout', {
      root: 'ws',
      branch: 'feature/x',
      create: false,
    })
    expect(toastError).toHaveBeenCalled()
    const arg = toastError.mock.calls[0]![0] as string
    expect(arg.toLowerCase()).toContain('ungesicherte')
  })

  it('"Neuen Branch erstellen…" prompts and POSTs with create:true', async () => {
    wireDefaults()
    promptFn.mockResolvedValue('topic/y')
    apiPost.mockResolvedValue(gitOk())
    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('__create__')
    await flushPromises()

    expect(promptFn).toHaveBeenCalled()
    expect(apiPost).toHaveBeenCalledWith('/api/workspace/git/checkout', {
      root: 'ws',
      branch: 'topic/y',
      create: true,
    })
  })

  it('pull conflict surfaces the file list inline', async () => {
    wireDefaults()
    const conflict: GitPullResponse = {
      ok: false,
      message: 'Automatic merge failed; fix conflicts and then commit.',
      conflicts: ['README.md', 'src/x.py'],
    }
    apiPost.mockImplementation((path: string) => {
      if (path === '/api/workspace/git/pull') return Promise.resolve(conflict)
      throw new Error(`unexpected POST ${path}`)
    })

    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()

    const pullBtn = wrapper.findAll('button').find((b) => b.text().includes('Pull'))
    expect(pullBtn).toBeTruthy()
    await pullBtn!.trigger('click')
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Konflikte manuell auflösen')
    expect(text).toContain('README.md')
    expect(text).toContain('src/x.py')
  })

  it('discard 403 surfaces the destructive-flag hint via toast.error', async () => {
    wireDefaults()
    apiPost.mockImplementation((path: string) => {
      if (path === '/api/workspace/git/discard') {
        return Promise.reject(
          httpError(403, 'destructive git ops disabled (set HERMES_WORKSPACE_GIT_DESTRUCTIVE=1)'),
        )
      }
      throw new Error(`unexpected POST ${path}`)
    })

    const wrapper = mount(WorkspaceGitTab, {
      global: { stubs },
      props: { root: 'ws', conversationId: 1 },
    })
    await flushPromises()

    const discardBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Verwerfen')
    expect(discardBtn).toBeTruthy()
    await discardBtn!.trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
    const arg = toastError.mock.calls[0]![0] as string
    expect(arg).toContain('HERMES_WORKSPACE_GIT_DESTRUCTIVE')
  })
})
