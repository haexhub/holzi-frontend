<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { File, FileQuestion, Folder, RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RenderedMarkdown from '~/components/chat/RenderedMarkdown.vue'
import { useApi } from '~/composables/useApi'
import type {
  TreeEntry,
  WorkspaceFileResponse,
  WorkspaceRoot,
  WorkspaceRootsResponse,
  WorkspaceTreeResponse,
} from '~/types/api'

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

// Monotonic seq guards against stale-response races. A user clicking dir A
// then quickly switching to root B would otherwise let A's late response
// overwrite B's state; same shape for file selection. Each fetch captures
// the seq at start and bails on commit if a newer fetch has begun.
let treeSeq = 0
let fileSeq = 0

function errorStatus(err: unknown): number | null {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } }
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? null
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
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
      // Don't await — a slow tree fetch must not block rootsLoading from
      // flipping back; otherwise the root selector stays hidden behind
      // "Lädt…" and the user can't switch roots while the first tree loads.
      void loadTree()
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
      const data = (err as { data?: { detail?: string } })?.data
      treeError.value = data?.detail ?? 'Ungültiger Pfad.'
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
      const data = (err as { data?: { detail?: string } })?.data
      fileError.value = data?.detail ?? 'Ungültiger Pfad.'
    } else {
      fileError.value = errorMessage(err, 'Fehler beim Laden der Datei.')
    }
  } finally {
    if (seq === fileSeq) fileLoading.value = false
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
    void loadFile(entry.name)
  }
}

function navigateBreadcrumb(index: number) {
  // -1 = root, otherwise navigate to the segment at index inclusive.
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
  void loadTree()
}

async function refresh() {
  await loadTree()
  if (selectedFileName.value) {
    await loadFile(selectedFileName.value)
  }
}

onMounted(loadRoots)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b p-3">
      <h3 class="text-sm font-semibold">Workspace</h3>
      <Button
        v-if="roots.length > 0"
        size="sm"
        variant="ghost"
        :disabled="treeLoading || fileLoading"
        :aria-label="'Aktualisieren'"
        @click="refresh"
      >
        <RefreshCw
          class="size-3.5"
          :class="treeLoading || fileLoading ? 'animate-spin' : ''"
        />
      </Button>
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
          <div class="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
            <span class="truncate font-mono">{{ filePreview.name }}</span>
            <span>{{ humanSize(filePreview.size) }}</span>
          </div>
          <div
            v-if="filePreview.truncated"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            Vorschau gekürzt — Datei ist größer als 256 KiB.
          </div>
          <div class="flex-1 overflow-auto">
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
