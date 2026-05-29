<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  File,
  FileQuestion,
  Folder,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RenderedMarkdown from '~/components/chat/RenderedMarkdown.vue'
import { useApi } from '~/composables/useApi'
import type {
  TreeEntry,
  WorkspaceFileResponse,
  WorkspaceGitResponse,
  WorkspaceRenameResponse,
  WorkspaceRoot,
  WorkspaceRootsResponse,
  WorkspaceTreeResponse,
  WorkspaceWriteResponse,
} from '~/types/api'

// Threaded through from index.vue so workspace writes can produce
// `user[conv-N]:` git commits. Null when no conversation is active —
// the panel disables write actions in that case rather than committing
// anonymously. Default `null` lets the panel render in isolation (tests,
// settings-style routes) without forcing every caller to pass it.
const props = withDefaults(
  defineProps<{ conversationId?: number | null }>(),
  { conversationId: null },
)

const api = useApi()

const roots = ref<WorkspaceRoot[]>([])
const selectedRoot = ref<string>('')
const currentPath = ref<string>('')
const entries = ref<TreeEntry[]>([])

const rootsLoading = ref(false)
const treeLoading = ref(false)
const fileLoading = ref(false)

const rootsError = ref<string | null>(null)
const treeError = ref<string | null>(null)
const fileError = ref<string | null>(null)

const selectedFileName = ref<string | null>(null)
const filePreview = ref<WorkspaceFileResponse | null>(null)

const gitStatus = ref<WorkspaceGitResponse | null>(null)
const gitError = ref<string | null>(null)

// Edit-mode state. `editing` toggles preview→textarea; `editingContent`
// holds the in-progress draft so cancel can discard cleanly.
const editing = ref(false)
const editingContent = ref<string>('')
const saveError = ref<string | null>(null)
// Distinct from `saveError`: a successful write that produced no commit
// (root isn't a git repo) is *not* an error, so it gets its own neutral
// banner instead of red-tinting a happy path.
const saveNotice = ref<string | null>(null)
const saving = ref(false)

// Create-file flyout state.
const creating = ref(false)
const createPath = ref<string>('')
const createError = ref<string | null>(null)
const createSaving = ref(false)

// Monotonic seq guards against stale-response races. A user clicking dir A
// then quickly switching to root B would otherwise let A's late response
// overwrite B's state; same shape for file selection. Each fetch captures
// the seq at start and bails on commit if a newer fetch has begun.
let treeSeq = 0
let fileSeq = 0
let gitSeq = 0

function errorStatus(err: unknown): number | null {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } }
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? null
}

function errorDetail(err: unknown): string | null {
  const e = err as { data?: { detail?: string }; response?: { _data?: { detail?: string } } }
  return e?.data?.detail ?? e?.response?._data?.detail ?? null
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// Single source of truth for "stringify the active conversation for a
// `user[conv-N]:` commit". Throws loudly if called without a conversation;
// the UI's `canWrite` gate is supposed to prevent that, so reaching this
// branch means a guard regressed somewhere — better to fail loud than to
// send `"null"` as the conversation id.
function commitConvId(): string {
  const id = props.conversationId
  if (id == null) throw new Error('no active conversation')
  return String(id)
}

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return 'Größe unbekannt'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(1)} ${units[i]}`
}

const sortedEntries = computed<TreeEntry[]>(() => {
  const list = [...entries.value]
  list.sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1
    const bd = b.type === 'dir' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return list
})

const breadcrumbSegments = computed<string[]>(() => {
  if (!currentPath.value) return []
  return currentPath.value.split('/').filter((s) => s.length > 0)
})

const canWrite = computed<boolean>(() => {
  // Plan 13 contract: every write produces a `user[conv-N]:` commit, so a
  // missing conversation id means the write would have an ambiguous author.
  // Better to disable the action than to commit anonymously.
  return props.conversationId != null
})

const canEditCurrent = computed<boolean>(() => {
  const p = filePreview.value
  if (!p || !canWrite.value) return false
  if (p.kind !== 'text' && p.kind !== 'markdown') return false
  // sha256 absent = file was metadata-only (too large to read fully) — editing
  // it would have no `base_sha` and any save would be unsafe by definition.
  return p.sha256 != null
})

function joinPath(base: string, name: string): string {
  if (!base) return name
  return `${base}/${name}`
}

async function loadRoots() {
  rootsLoading.value = true
  rootsError.value = null
  try {
    const res = await api.get<WorkspaceRootsResponse>('/api/workspace/roots')
    roots.value = res.roots
    if (res.roots.length > 0) {
      selectedRoot.value = res.roots[0]!.id
      currentPath.value = ''
      void loadTree()
      void loadGit()
    }
  } catch (err: unknown) {
    rootsError.value = errorMessage(err, 'Fehler beim Laden der Workspaces.')
  } finally {
    rootsLoading.value = false
  }
}

async function loadTree() {
  if (!selectedRoot.value) return
  const seq = ++treeSeq
  treeLoading.value = true
  treeError.value = null
  entries.value = []
  try {
    const res = await api.get<WorkspaceTreeResponse>('/api/workspace/tree', {
      root: selectedRoot.value,
      path: currentPath.value,
    })
    if (seq !== treeSeq) return
    entries.value = res.entries
  } catch (err: unknown) {
    if (seq !== treeSeq) return
    const status = errorStatus(err)
    if (status === 503) {
      treeError.value = 'Workspace nicht verfügbar — Sandbox läuft nicht oder ist nicht konfiguriert.'
    } else if (status === 404) {
      treeError.value = 'Pfad nicht gefunden.'
    } else if (status === 400) {
      treeError.value = errorDetail(err) ?? 'Ungültiger Pfad.'
    } else {
      treeError.value = errorMessage(err, 'Fehler beim Laden des Verzeichnisses.')
    }
  } finally {
    if (seq === treeSeq) treeLoading.value = false
  }
}

async function loadFile(name: string) {
  if (!selectedRoot.value) return
  const seq = ++fileSeq
  fileLoading.value = true
  fileError.value = null
  filePreview.value = null
  selectedFileName.value = name
  // Switching files always exits edit mode — any unsaved draft is dropped.
  // The watcher below also enforces this for breadcrumb/root nav.
  editing.value = false
  editingContent.value = ''
  saveError.value = null
  try {
    const res = await api.get<WorkspaceFileResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path: joinPath(currentPath.value, name),
    })
    if (seq !== fileSeq) return
    filePreview.value = res
  } catch (err: unknown) {
    if (seq !== fileSeq) return
    const status = errorStatus(err)
    if (status === 503) {
      fileError.value = 'Workspace nicht verfügbar — Sandbox läuft nicht oder ist nicht konfiguriert.'
    } else if (status === 404) {
      fileError.value = 'Datei nicht gefunden.'
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? 'Ungültiger Pfad.'
    } else {
      fileError.value = errorMessage(err, 'Fehler beim Laden der Datei.')
    }
  } finally {
    if (seq === fileSeq) fileLoading.value = false
  }
}

async function loadGit() {
  if (!selectedRoot.value) return
  const seq = ++gitSeq
  gitError.value = null
  try {
    const res = await api.get<WorkspaceGitResponse>('/api/workspace/git', {
      root: selectedRoot.value,
    })
    if (seq !== gitSeq) return
    gitStatus.value = res
  } catch (err: unknown) {
    if (seq !== gitSeq) return
    // Git status is best-effort — failures shouldn't block the rest of the
    // panel. We surface the error inline near the badge area but keep the
    // tree + preview functioning.
    const status = errorStatus(err)
    if (status === 503) {
      gitError.value = 'Sandbox nicht verfügbar.'
    } else {
      gitError.value =
        errorDetail(err) ?? errorMessage(err, 'Git-Status nicht verfügbar.')
    }
    gitStatus.value = null
  }
}

function onEntryClick(entry: TreeEntry) {
  if (entry.type === 'dir') {
    currentPath.value = joinPath(currentPath.value, entry.name)
    selectedFileName.value = null
    filePreview.value = null
    fileError.value = null
    void loadTree()
  } else if (entry.type === 'file') {
    // Clear a stale tree error: if a previous /tree fetch errored but
    // some entries are still visible (e.g. cached list), opening a file
    // shouldn't leave the error message dangling above the new preview.
    treeError.value = null
    void loadFile(entry.name)
  }
}

function navigateBreadcrumb(index: number) {
  if (index < 0) {
    currentPath.value = ''
  } else {
    currentPath.value = breadcrumbSegments.value.slice(0, index + 1).join('/')
  }
  selectedFileName.value = null
  filePreview.value = null
  fileError.value = null
  void loadTree()
}

function onRootChange() {
  currentPath.value = ''
  selectedFileName.value = null
  filePreview.value = null
  fileError.value = null
  gitStatus.value = null
  // Drop the create flyout too — its `createPath` is rooted under the
  // previous workspace's breadcrumb, so leaving it open would invite the
  // user to create a file at the wrong place.
  creating.value = false
  createPath.value = ''
  createError.value = null
  void loadTree()
  void loadGit()
}

async function refresh() {
  await Promise.all([loadTree(), loadGit()])
  if (selectedFileName.value) {
    await loadFile(selectedFileName.value)
  }
}

function startEditing() {
  if (!canEditCurrent.value || !filePreview.value) return
  editing.value = true
  editingContent.value = filePreview.value.content ?? ''
  saveError.value = null
  saveNotice.value = null
}

function cancelEditing() {
  editing.value = false
  editingContent.value = ''
  saveError.value = null
  saveNotice.value = null
}

async function saveEdit() {
  const preview = filePreview.value
  if (!preview || !canWrite.value || preview.sha256 == null) return
  // Capture the workspace context at the moment the user clicked Save —
  // if the user switches root or selects a different file while the PUT
  // is in flight, we must not reload the *new* root's file as if the
  // write happened there.
  const rootAtSave = selectedRoot.value
  const nameAtSave = preview.name
  saving.value = true
  saveError.value = null
  saveNotice.value = null
  try {
    const res = await api.put<WorkspaceWriteResponse>('/api/workspace/file', {
      root: rootAtSave,
      path: preview.path,
      content: editingContent.value,
      base_sha: preview.sha256,
      conversation_id: commitConvId(),
    })
    editing.value = false
    editingContent.value = ''
    if (selectedRoot.value !== rootAtSave) {
      // The user navigated away mid-save; the write succeeded against
      // `rootAtSave` but there's no longer a UI position to surface the
      // refreshed preview in. Just exit edit mode silently.
      return
    }
    // Refresh from server so the new sha + truncation state come from the
    // canonical source rather than a guess. Also refreshes the dirty badge.
    await Promise.all([
      loadFile(nameAtSave),
      loadGit(),
    ])
    if (res.committed === false) {
      // Successful write, just without a commit (root isn't a git repo).
      // A neutral notice — not an error.
      saveNotice.value = 'Gespeichert (kein Git-Repo, kein Commit erstellt).'
    }
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      saveError.value =
        'Konflikt: Datei wurde auf der Festplatte geändert. Bitte neu laden und erneut bearbeiten.'
    } else if (status === 400) {
      saveError.value = errorDetail(err) ?? 'Ungültiger Inhalt.'
    } else if (status === 503) {
      saveError.value = 'Workspace nicht verfügbar.'
    } else {
      saveError.value = errorMessage(err, 'Speichern fehlgeschlagen.')
    }
  } finally {
    saving.value = false
  }
}

function startCreating() {
  if (!canWrite.value) return
  creating.value = true
  createError.value = null
  createPath.value = currentPath.value ? `${currentPath.value}/` : ''
}

function cancelCreating() {
  creating.value = false
  createPath.value = ''
  createError.value = null
}

async function submitCreate() {
  if (!canWrite.value) return
  const path = createPath.value.trim()
  if (!path) {
    createError.value = 'Pfad darf nicht leer sein.'
    return
  }
  createSaving.value = true
  createError.value = null
  try {
    await api.post<WorkspaceWriteResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path,
      content: '',
      conversation_id: commitConvId(),
    })
    creating.value = false
    createPath.value = ''
    await Promise.all([loadTree(), loadGit()])
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      createError.value = 'Pfad existiert bereits.'
    } else if (status === 400) {
      createError.value = errorDetail(err) ?? 'Ungültiger Pfad.'
    } else if (status === 503) {
      createError.value = 'Workspace nicht verfügbar.'
    } else {
      createError.value = errorMessage(err, 'Anlegen fehlgeschlagen.')
    }
  } finally {
    createSaving.value = false
  }
}

async function renameCurrent() {
  const preview = filePreview.value
  if (!preview || !canWrite.value) return
  const next = window.prompt('Neuer Pfad (relativ zur Workspace-Wurzel):', preview.path)
  if (next == null) return
  const target = next.trim()
  if (!target || target === preview.path) return
  try {
    const res = await api.post<WorkspaceRenameResponse>(
      '/api/workspace/rename',
      {
        root: selectedRoot.value,
        src: preview.path,
        dest: target,
        conversation_id: commitConvId(),
      },
    )
    // After rename, the file lives at a new path; clear selection and
    // navigate to the dest's parent so the user can see the result.
    const lastSlash = res.dest.lastIndexOf('/')
    currentPath.value = lastSlash === -1 ? '' : res.dest.slice(0, lastSlash)
    const newName = lastSlash === -1 ? res.dest : res.dest.slice(lastSlash + 1)
    selectedFileName.value = null
    filePreview.value = null
    await Promise.all([loadTree(), loadGit()])
    await loadFile(newName)
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      fileError.value = 'Zielpfad existiert bereits.'
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? 'Ungültiger Pfad.'
    } else if (status === 404) {
      fileError.value = 'Datei nicht gefunden.'
    } else if (status === 503) {
      fileError.value = 'Workspace nicht verfügbar.'
    } else {
      fileError.value = errorMessage(err, 'Umbenennen fehlgeschlagen.')
    }
  }
}

async function deleteCurrent() {
  const preview = filePreview.value
  if (!preview || !canWrite.value) return
  // Destructive — always confirm. Plan 13 explicitly calls out "Require
  // confirmations for destructive operations."
  if (!window.confirm(`Datei "${preview.path}" wirklich löschen?`)) return
  try {
    await api.delete<WorkspaceWriteResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path: preview.path,
      conversation_id: commitConvId(),
    })
    selectedFileName.value = null
    filePreview.value = null
    fileError.value = null
    await Promise.all([loadTree(), loadGit()])
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 404) {
      fileError.value = 'Datei nicht gefunden.'
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? 'Ungültiger Pfad.'
    } else if (status === 503) {
      fileError.value = 'Workspace nicht verfügbar.'
    } else {
      fileError.value = errorMessage(err, 'Löschen fehlgeschlagen.')
    }
  }
}

// Drop any unsaved edit if the user navigates away (root/breadcrumb/file
// change) OR if the active conversation disappears. The latter matters
// because `canWrite` flips false when conversationId becomes null, which
// would otherwise leave the user in an edit mode whose Save silently
// no-ops at the `canWrite` guard.
watch(
  [selectedRoot, currentPath, selectedFileName, () => props.conversationId],
  () => {
    editing.value = false
    editingContent.value = ''
    saveError.value = null
    saveNotice.value = null
  },
)

onMounted(loadRoots)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b p-3">
      <h3 class="text-sm font-semibold">Workspace</h3>
      <div class="flex items-center gap-1">
        <Button
          v-if="roots.length > 0 && canWrite"
          size="sm"
          variant="ghost"
          :disabled="treeLoading || creating"
          aria-label="Neue Datei"
          @click="startCreating"
        >
          <Plus class="size-3.5" />
        </Button>
        <Button
          v-if="roots.length > 0"
          size="sm"
          variant="ghost"
          :disabled="treeLoading || fileLoading"
          aria-label="Aktualisieren"
          @click="refresh"
        >
          <RefreshCw
            class="size-3.5"
            :class="treeLoading || fileLoading ? 'animate-spin' : ''"
          />
        </Button>
      </div>
    </div>

    <div v-if="rootsLoading" class="p-3 text-sm text-muted-foreground">Lädt…</div>
    <div v-else-if="rootsError" class="p-3 text-sm text-destructive">{{ rootsError }}</div>
    <div
      v-else-if="roots.length === 0"
      class="p-3 text-sm text-muted-foreground"
    >
      Keine Workspaces konfiguriert. Setze HERMES_WORKSPACE_ROOTS.
    </div>

    <template v-else>
      <div class="space-y-2 border-b p-3">
        <select
          v-model="selectedRoot"
          class="w-full rounded-md border bg-background px-2 py-1 text-sm"
          @change="onRootChange"
        >
          <option v-for="r in roots" :key="r.id" :value="r.id">{{ r.id }}</option>
        </select>
        <div
          v-if="gitStatus && gitStatus.is_repo"
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <GitBranch class="size-3" />
          <span class="font-mono">{{ gitStatus.branch ?? '(detached)' }}</span>
          <span
            v-if="gitStatus.dirty"
            class="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300"
            :title="`${gitStatus.entries.length} geänderte Datei(en)`"
          >dirty</span>
          <span v-else class="text-emerald-700 dark:text-emerald-300">clean</span>
        </div>
        <div v-else-if="gitError" class="text-xs text-muted-foreground">
          {{ gitError }}
        </div>
        <nav class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            class="rounded px-1 hover:bg-muted hover:text-foreground"
            @click="navigateBreadcrumb(-1)"
          >
            {{ selectedRoot || '/' }}
          </button>
          <template v-for="(seg, i) in breadcrumbSegments" :key="i">
            <span>/</span>
            <button
              type="button"
              class="rounded px-1 hover:bg-muted hover:text-foreground"
              @click="navigateBreadcrumb(i)"
            >
              {{ seg }}
            </button>
          </template>
        </nav>
        <div
          v-if="creating"
          class="rounded-md border bg-muted/30 p-2 text-xs"
        >
          <label class="block">
            <span class="text-muted-foreground">Neue Datei (relativer Pfad):</span>
            <input
              v-model="createPath"
              type="text"
              class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
              placeholder="src/new.py"
              :disabled="createSaving"
              @keydown.enter.prevent="submitCreate"
              @keydown.esc.prevent="cancelCreating"
            />
          </label>
          <p v-if="createError" class="mt-1 text-destructive">{{ createError }}</p>
          <div class="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              :disabled="createSaving"
              @click="cancelCreating"
            >
              Abbrechen
            </Button>
            <Button size="sm" :disabled="createSaving" @click="submitCreate">
              Anlegen
            </Button>
          </div>
        </div>
        <p
          v-if="!canWrite"
          class="text-xs text-muted-foreground"
        >
          Wähle eine Konversation, um Dateien zu bearbeiten.
        </p>
      </div>

      <div class="flex-1 overflow-y-auto border-b">
        <p v-if="treeLoading" class="p-3 text-sm text-muted-foreground">Lädt…</p>
        <p v-else-if="treeError" class="p-3 text-sm text-destructive">{{ treeError }}</p>
        <p
          v-else-if="sortedEntries.length === 0"
          class="p-3 text-sm text-muted-foreground"
        >
          Ordner ist leer.
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="entry in sortedEntries"
            :key="entry.name"
            class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
            :class="[
              entry.name.startsWith('.') ? 'opacity-60' : '',
              selectedFileName === entry.name && entry.type === 'file' ? 'bg-accent' : '',
            ]"
            @click="onEntryClick(entry)"
          >
            <Folder v-if="entry.type === 'dir'" class="size-3.5 text-muted-foreground" />
            <File v-else-if="entry.type === 'file'" class="size-3.5 text-muted-foreground" />
            <FileQuestion v-else class="size-3.5 text-muted-foreground" />
            <span class="flex-1 truncate">{{ entry.name }}</span>
            <span v-if="entry.type === 'file'" class="text-xs text-muted-foreground">
              {{ humanSize(entry.size) }}
            </span>
          </li>
        </ul>
      </div>

      <div
        class="flex h-1/2 min-h-[160px] flex-col overflow-hidden"
        aria-live="polite"
      >
        <div v-if="fileLoading" class="p-3 text-sm text-muted-foreground">Lädt…</div>
        <div v-else-if="fileError" class="p-3 text-sm text-destructive">{{ fileError }}</div>
        <div
          v-else-if="!filePreview"
          class="p-3 text-sm text-muted-foreground"
        >
          Datei auswählen…
        </div>
        <template v-else>
          <div class="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span class="truncate font-mono">{{ filePreview.name }}</span>
            <div class="flex shrink-0 items-center gap-1">
              <span>{{ humanSize(filePreview.size) }}</span>
              <Button
                v-if="canEditCurrent && !editing"
                size="sm"
                variant="ghost"
                aria-label="Bearbeiten"
                @click="startEditing"
              >
                <Pencil class="size-3.5" />
              </Button>
              <Button
                v-if="canWrite && !editing"
                size="sm"
                variant="ghost"
                aria-label="Umbenennen"
                @click="renameCurrent"
              >
                <File class="size-3.5" />
              </Button>
              <Button
                v-if="canWrite && !editing"
                size="sm"
                variant="ghost"
                aria-label="Löschen"
                class="text-destructive hover:text-destructive"
                @click="deleteCurrent"
              >
                <Trash2 class="size-3.5" />
              </Button>
            </div>
          </div>
          <div
            v-if="filePreview.truncated && !editing"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            Vorschau gekürzt — Datei ist größer als 256 KiB.
          </div>
          <div
            v-if="saveError"
            class="border-b bg-muted px-3 py-1 text-xs text-destructive"
          >
            {{ saveError }}
          </div>
          <div
            v-else-if="saveNotice"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {{ saveNotice }}
          </div>
          <div v-if="editing" class="flex flex-1 flex-col overflow-hidden">
            <textarea
              v-model="editingContent"
              class="flex-1 resize-none border-0 bg-background p-3 font-mono text-xs focus:outline-none"
              :disabled="saving"
              spellcheck="false"
            />
            <div class="flex justify-end gap-2 border-t p-2">
              <Button
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="cancelEditing"
              >
                Abbrechen
              </Button>
              <Button size="sm" :disabled="saving" @click="saveEdit">
                {{ saving ? 'Speichert…' : 'Speichern' }}
              </Button>
            </div>
          </div>
          <div v-else class="flex-1 overflow-auto">
            <pre
              v-if="filePreview.kind === 'text'"
              class="whitespace-pre p-3 font-mono text-xs"
            >{{ filePreview.content }}</pre>
            <div v-else-if="filePreview.kind === 'markdown'" class="p-3">
              <RenderedMarkdown :content="filePreview.content ?? ''" />
            </div>
            <div
              v-else-if="filePreview.kind === 'image' && filePreview.data_url"
              class="flex items-center justify-center p-3"
            >
              <img
                :src="filePreview.data_url"
                :alt="filePreview.name"
                loading="lazy"
                class="max-h-[400px] max-w-full object-contain"
              />
            </div>
            <div v-else class="p-3 text-sm text-muted-foreground">
              <p class="font-mono">{{ filePreview.name }}</p>
              <p class="mt-1">{{ humanSize(filePreview.size) }}</p>
              <p class="mt-2">Vorschau nicht verfügbar (Binärdatei).</p>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
