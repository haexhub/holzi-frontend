<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import RenderedMarkdown from '~/components/chat/RenderedMarkdown.vue'
import { useApi } from '~/composables/useApi'
import { usePromptDialog } from '~/composables/usePromptDialog'
import { useToast } from '~/composables/useToast'
import type {
  GitBranchesResponse,
  GitDiffResponse,
  GitOpResponse,
  GitPullResponse,
  WorkspaceGitResponse,
} from '~/types/api'

const props = defineProps<{
  root: string
  conversationId: number | null
}>()

const emit = defineEmits<{
  /**
   * Fired after any mutation (stage/commit/checkout/pull/push) so the
   * parent panel can refresh its tree + status badge without each tab
   * having to know about the parent's state.
   */
  (e: 'changed'): void
}>()

const api = useApi()
const { prompt } = usePromptDialog()
const toast = useToast()

const status = ref<WorkspaceGitResponse | null>(null)
const branches = ref<GitBranchesResponse | null>(null)
const diff = ref<GitDiffResponse | null>(null)
const selectedPath = ref<string | null>(null)
// `staged` vs `unstaged` determines which `git diff` to fetch and which
// per-row action set to show. A single `MM` file produces two rows (one
// in each group); selectedSide stores which row is active.
const selectedSide = ref<'unstaged' | 'staged'>('unstaged')

const statusLoading = ref(false)
const branchesLoading = ref(false)
const diffLoading = ref(false)
const remoteBusy = ref(false)
const commitBusy = ref(false)

const statusError = ref<string | null>(null)
const branchesError = ref<string | null>(null)
const diffError = ref<string | null>(null)
const remoteMessage = ref<string | null>(null)
const pullConflicts = ref<string[]>([])

const commitMessage = ref('')

let statusSeq = 0
let branchesSeq = 0
let diffSeq = 0

const canWrite = computed(() => props.conversationId !== null)

function errorDetail(err: unknown): string | null {
  const e = err as {
    data?: { detail?: string }
    response?: { _data?: { detail?: string } }
    statusCode?: number
  }
  return e?.data?.detail ?? e?.response?._data?.detail ?? null
}
function errorMsg(err: unknown, fallback: string): string {
  return errorDetail(err) ?? (err instanceof Error ? err.message : fallback)
}
function errorStatus(err: unknown): number | null {
  return (err as { statusCode?: number; status?: number })?.statusCode
    ?? (err as { status?: number })?.status
    ?? null
}

async function fetchStatus(): Promise<void> {
  if (!props.root) return
  const seq = ++statusSeq
  statusLoading.value = true
  statusError.value = null
  try {
    const res = await api.get<WorkspaceGitResponse>(`/api/workspace/git`, {
      root: props.root,
    })
    if (seq === statusSeq) status.value = res
  } catch (err) {
    if (seq === statusSeq) {
      statusError.value = errorMsg(err, 'Git-Status konnte nicht geladen werden.')
      status.value = null
    }
  } finally {
    if (seq === statusSeq) statusLoading.value = false
  }
}

async function fetchBranches(): Promise<void> {
  if (!props.root) return
  const seq = ++branchesSeq
  branchesLoading.value = true
  branchesError.value = null
  try {
    const res = await api.get<GitBranchesResponse>(
      `/api/workspace/git/branches`,
      { root: props.root },
    )
    if (seq === branchesSeq) branches.value = res
  } catch (err) {
    if (seq === branchesSeq) {
      branchesError.value = errorMsg(err, 'Branches konnten nicht geladen werden.')
      branches.value = null
    }
  } finally {
    if (seq === branchesSeq) branchesLoading.value = false
  }
}

async function fetchDiff(): Promise<void> {
  if (!props.root) return
  const seq = ++diffSeq
  diffLoading.value = true
  diffError.value = null
  try {
    const query: Record<string, unknown> = {
      root: props.root,
      staged: selectedSide.value === 'staged',
    }
    if (selectedPath.value) query.path = selectedPath.value
    const res = await api.get<GitDiffResponse>(
      `/api/workspace/git/diff`,
      query,
    )
    if (seq === diffSeq) diff.value = res
  } catch (err) {
    if (seq === diffSeq) {
      diffError.value = errorMsg(err, 'Diff konnte nicht geladen werden.')
      diff.value = null
    }
  } finally {
    if (seq === diffSeq) diffLoading.value = false
  }
}

async function refreshAll(): Promise<void> {
  // Status + branches in parallel; diff follows because its query depends
  // on which file is selected (and that may change with a status refresh).
  await Promise.all([fetchStatus(), fetchBranches()])
  await fetchDiff()
}

// Each Plan-24 entry has porcelain XY status. Group into "staged" (index
// side X != space/?) and "unstaged" (working tree side Y != space). A
// single `MM` file lands in both buckets — that's intentional.
const stagedEntries = computed(() => {
  if (!status.value) return []
  return status.value.entries.filter((e) => {
    const x = e.status[0] ?? ' '
    return x !== ' ' && x !== '?'
  })
})
const unstagedEntries = computed(() => {
  if (!status.value) return []
  return status.value.entries.filter((e) => {
    const y = e.status[1] ?? ' '
    // `??` shows up as both X and Y == '?' — we want it under Unstaged.
    if (e.status === '??') return true
    return y !== ' '
  })
})

function selectFile(path: string, side: 'unstaged' | 'staged') {
  selectedPath.value = path
  selectedSide.value = side
  fetchDiff()
}

async function stageOne(path: string) {
  await runOp(
    () => api.post<GitOpResponse>(`/api/workspace/git/stage`, {
      root: props.root,
      paths: [path],
    }),
    'Datei staged.',
  )
}

async function unstageOne(path: string) {
  await runOp(
    () => api.post<GitOpResponse>(`/api/workspace/git/unstage`, {
      root: props.root,
      paths: [path],
    }),
    'Datei unstaged.',
  )
}

async function discardOne(path: string) {
  if (!canWrite.value) {
    toast.warning('Bitte zuerst eine Konversation auswählen.')
    return
  }
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/discard`, {
      root: props.root,
      paths: [path],
      conversation_id: String(props.conversationId),
    })
    toast.success('Lokale Änderungen verworfen.')
    await refreshAll()
    emit('changed')
  } catch (err) {
    if (errorStatus(err) === 403) {
      toast.error(
        'Destruktive Git-Operationen sind serverseitig deaktiviert '
          + '(HERMES_WORKSPACE_GIT_DESTRUCTIVE).',
      )
    } else {
      toast.error(errorMsg(err, 'Verwerfen fehlgeschlagen.'))
    }
  }
}

async function runOp(
  call: () => Promise<GitOpResponse>,
  successMessage: string,
): Promise<void> {
  try {
    await call()
    toast.success(successMessage)
    await refreshAll()
    emit('changed')
  } catch (err) {
    toast.error(errorMsg(err, 'Aktion fehlgeschlagen.'))
  }
}

async function commit() {
  if (!commitMessage.value.trim()) {
    toast.warning('Bitte eine Commit-Nachricht eingeben.')
    return
  }
  if (!canWrite.value) {
    toast.warning('Bitte zuerst eine Konversation auswählen.')
    return
  }
  commitBusy.value = true
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/commit`, {
      root: props.root,
      message: commitMessage.value.trim(),
      conversation_id: String(props.conversationId),
      all: false,
    })
    toast.success('Commit erstellt.')
    commitMessage.value = ''
    await refreshAll()
    emit('changed')
  } catch (err) {
    toast.error(errorMsg(err, 'Commit fehlgeschlagen.'))
  } finally {
    commitBusy.value = false
  }
}

async function onBranchSelect(target: string | '__create__') {
  if (target === '__create__') {
    const name = await prompt({
      title: 'Neuen Branch erstellen',
      description: 'Name des neuen Branches',
      placeholder: 'feature/x',
    })
    if (!name) return
    await checkoutBranch(name.trim(), true)
    return
  }
  if (target && target !== branches.value?.current) {
    await checkoutBranch(target, false)
  }
}

async function checkoutBranch(branch: string, create: boolean) {
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/checkout`, {
      root: props.root,
      branch,
      create,
    })
    toast.success(create ? `Branch "${branch}" angelegt.` : `Auf "${branch}" gewechselt.`)
    selectedPath.value = null
    await refreshAll()
    emit('changed')
  } catch (err) {
    if (errorStatus(err) === 409) {
      toast.error(
        'Working tree enthält ungesicherte Änderungen — '
          + 'erst commit/discard/stash, dann erneut versuchen.',
      )
    } else {
      toast.error(errorMsg(err, 'Checkout fehlgeschlagen.'))
    }
  }
}

async function fetchRemote() {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitOpResponse>(`/api/workspace/git/fetch`, {
      root: props.root,
    })
    remoteMessage.value = res.ok
      ? (res.message || 'Fetch erfolgreich.')
      : `Fetch fehlgeschlagen: ${res.message}`
    await refreshAll()
  } catch (err) {
    remoteMessage.value = errorMsg(err, 'Fetch fehlgeschlagen.')
  } finally {
    remoteBusy.value = false
  }
}

async function pullRemote() {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitPullResponse>(`/api/workspace/git/pull`, {
      root: props.root,
    })
    if (res.ok) {
      remoteMessage.value = res.message || 'Pull erfolgreich.'
    } else {
      remoteMessage.value = res.message
      pullConflicts.value = res.conflicts ?? []
    }
    await refreshAll()
    emit('changed')
  } catch (err) {
    remoteMessage.value = errorMsg(err, 'Pull fehlgeschlagen.')
  } finally {
    remoteBusy.value = false
  }
}

async function pushRemote(setUpstream: boolean) {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitOpResponse>(`/api/workspace/git/push`, {
      root: props.root,
      set_upstream: setUpstream,
    })
    remoteMessage.value = res.ok
      ? (res.message || 'Push erfolgreich.')
      : `Push fehlgeschlagen: ${res.message}`
  } catch (err) {
    remoteMessage.value = errorMsg(err, 'Push fehlgeschlagen.')
  } finally {
    remoteBusy.value = false
  }
}

// The diff body is rendered as a fenced ```diff block so shiki (already
// preloaded with the `diff` grammar — see app/utils/markdown.ts) handles
// the syntax highlighting we'd otherwise have to wire by hand.
const diffMarkdown = computed(() => {
  if (!diff.value || diff.value.kind !== 'text' || !diff.value.patch) return ''
  return `\`\`\`diff\n${diff.value.patch}\n\`\`\``
})

watch(
  () => props.root,
  () => {
    selectedPath.value = null
    selectedSide.value = 'unstaged'
    status.value = null
    branches.value = null
    diff.value = null
    if (props.root) refreshAll()
  },
  { immediate: true },
)

defineExpose({ refreshAll })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Branch + refresh row -->
    <div class="flex items-center gap-2 border-b p-3">
      <GitBranch class="size-4 shrink-0 text-muted-foreground" />
      <select
        class="flex-1 truncate rounded-md border bg-background px-2 py-1 text-sm"
        :disabled="branchesLoading || !branches"
        :value="branches?.current ?? ''"
        @change="onBranchSelect(($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!branches?.current" value="" disabled>
          {{ branchesLoading ? 'Lädt…' : '(detached)' }}
        </option>
        <option
          v-for="b in branches?.all ?? []"
          :key="b.name"
          :value="b.name"
          :disabled="b.is_remote"
        >
          {{ b.is_remote ? `remote: ${b.name}` : b.name }}
        </option>
        <option value="__create__">+ Neuen Branch erstellen…</option>
      </select>
      <Button
        size="sm"
        variant="ghost"
        :disabled="statusLoading || branchesLoading"
        aria-label="Aktualisieren"
        @click="refreshAll"
      >
        <RefreshCw
          class="size-3.5"
          :class="statusLoading || branchesLoading ? 'animate-spin' : ''"
        />
      </Button>
    </div>

    <!-- Status sections -->
    <div class="max-h-60 overflow-y-auto border-b">
      <div v-if="statusError" class="p-3 text-sm text-destructive">
        {{ statusError }}
      </div>
      <div
        v-else-if="!status || (!status.is_repo)"
        class="p-3 text-sm text-muted-foreground"
      >
        Kein Git-Repo in diesem Workspace.
      </div>
      <div
        v-else-if="stagedEntries.length === 0 && unstagedEntries.length === 0"
        class="p-3 text-sm text-muted-foreground"
      >
        Working tree clean.
      </div>
      <template v-else>
        <section v-if="unstagedEntries.length > 0">
          <h4 class="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unstaged ({{ unstagedEntries.length }})
          </h4>
          <ul class="divide-y text-sm">
            <li
              v-for="entry in unstagedEntries"
              :key="`u-${entry.path}`"
              class="flex items-center gap-2 px-3 py-1.5"
              :class="
                selectedPath === entry.path && selectedSide === 'unstaged'
                  ? 'bg-accent'
                  : 'hover:bg-muted'
              "
            >
              <span class="w-6 font-mono text-xs text-muted-foreground">
                {{ entry.status }}
              </span>
              <button
                type="button"
                class="flex-1 truncate text-left font-mono text-xs"
                @click="selectFile(entry.path, 'unstaged')"
              >
                {{ entry.path }}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Stage"
                :disabled="!canWrite"
                @click="stageOne(entry.path)"
              >
                <Plus class="size-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Verwerfen"
                class="text-destructive hover:text-destructive"
                :disabled="!canWrite"
                @click="discardOne(entry.path)"
              >
                <Trash2 class="size-3" />
              </Button>
            </li>
          </ul>
        </section>
        <section v-if="stagedEntries.length > 0">
          <h4 class="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Staged ({{ stagedEntries.length }})
          </h4>
          <ul class="divide-y text-sm">
            <li
              v-for="entry in stagedEntries"
              :key="`s-${entry.path}`"
              class="flex items-center gap-2 px-3 py-1.5"
              :class="
                selectedPath === entry.path && selectedSide === 'staged'
                  ? 'bg-accent'
                  : 'hover:bg-muted'
              "
            >
              <span class="w-6 font-mono text-xs text-muted-foreground">
                {{ entry.status }}
              </span>
              <button
                type="button"
                class="flex-1 truncate text-left font-mono text-xs"
                @click="selectFile(entry.path, 'staged')"
              >
                {{ entry.path }}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Unstage"
                :disabled="!canWrite"
                @click="unstageOne(entry.path)"
              >
                <Minus class="size-3" />
              </Button>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <!-- Diff viewer -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <div class="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span class="truncate font-mono">
          {{
            selectedPath
              ? `${selectedSide === 'staged' ? 'staged' : 'unstaged'} · ${selectedPath}`
              : 'Datei für Diff auswählen…'
          }}
        </span>
        <span v-if="diff && diff.kind !== 'none'" class="shrink-0">
          {{ diff.summary.files }} Datei(en) ·
          <span class="text-emerald-600 dark:text-emerald-400">+{{ diff.summary.insertions }}</span> /
          <span class="text-rose-600 dark:text-rose-400">-{{ diff.summary.deletions }}</span>
        </span>
      </div>
      <div class="flex-1 overflow-auto">
        <p v-if="diffLoading" class="p-3 text-sm text-muted-foreground">Lädt…</p>
        <p v-else-if="diffError" class="p-3 text-sm text-destructive">{{ diffError }}</p>
        <p
          v-else-if="!diff || diff.kind === 'none'"
          class="p-3 text-sm text-muted-foreground"
        >
          Keine Änderungen.
        </p>
        <p
          v-else-if="diff.kind === 'binary'"
          class="p-3 text-sm text-muted-foreground"
        >
          Binärdatei — kein Patch verfügbar.
        </p>
        <template v-else>
          <p
            v-if="diff.truncated"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            Patch gekürzt — Diff ist größer als 256 KiB.
          </p>
          <div class="p-3 text-xs">
            <RenderedMarkdown :content="diffMarkdown" />
          </div>
        </template>
      </div>
    </div>

    <!-- Commit row -->
    <div class="space-y-2 border-t p-3">
      <textarea
        v-model="commitMessage"
        class="min-h-15 w-full resize-y rounded-md border bg-background p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Commit-Nachricht…"
        :disabled="commitBusy || !canWrite"
        spellcheck="false"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          :disabled="commitBusy || !canWrite || !commitMessage.trim() || stagedEntries.length === 0"
          @click="commit"
        >
          {{ commitBusy ? 'Commit…' : 'Commit (staged)' }}
        </Button>
        <p
          v-if="!canWrite"
          class="text-xs text-muted-foreground"
        >
          Wähle eine Konversation, um zu committen.
        </p>
        <p
          v-else-if="stagedEntries.length === 0"
          class="text-xs text-muted-foreground"
        >
          Erst Dateien stagen, dann committen.
        </p>
      </div>
    </div>

    <!-- Remote ops + last-message banner -->
    <div class="space-y-2 border-t p-3">
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="fetchRemote"
        >
          Fetch
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="pullRemote"
        >
          <ArrowDown class="mr-1 size-3" /> Pull
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="pushRemote(false)"
        >
          <ArrowUp class="mr-1 size-3" /> Push
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="remoteBusy"
          @click="pushRemote(true)"
        >
          Push --set-upstream
        </Button>
      </div>
      <pre
        v-if="remoteMessage"
        class="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs"
      >{{ remoteMessage }}</pre>
      <div v-if="pullConflicts.length > 0" class="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs">
        <p class="font-semibold text-amber-700 dark:text-amber-300">
          Konflikte manuell auflösen:
        </p>
        <ul class="mt-1 list-disc space-y-0.5 pl-5 font-mono">
          <li v-for="path in pullConflicts" :key="path">{{ path }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
