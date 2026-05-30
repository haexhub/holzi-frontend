<script setup lang="ts">
import {
  Check,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Timer,
  Trash2,
  X,
} from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useTasks } from '~/composables/useTasks'
import type {
  AgentTask,
  AgentTaskCreate,
  AgentTaskUpdate,
} from '~/types/api'

// Plan 16 — /settings/tasks mirrors the memory panel's two-pane layout:
// left list (title + schedule chip + last-status dot), right detail/edit.
// A task is either one-shot (due_at) or recurring (5-field cron).

type Mode = 'empty' | 'read' | 'edit'
type ScheduleKind = 'once' | 'cron'

const { tasks, loading, error, load, create, patch, remove, runNow } = useTasks()
const { confirm } = useConfirm()

const selectedId = ref<number | null>(null)
const mode = ref<Mode>('empty')
const formError = ref<string | null>(null)
// Distinct from `error` (which surfaces list-load failures in the sidebar):
// run-now / pause / delete failures should appear next to where the user
// clicked, in the detail-pane header — not replace the task list.
const actionError = ref<string | null>(null)
const saving = ref(false)
const running = ref(false)

// IANA tz name to seed the form with. The picker only matters for cron
// tasks; one-shot tasks resolve their datetime-local input in the user's
// browser tz already. Defaulting to UTC would surprise non-UTC users when
// they switch to cron mode without realising they have to change the tz.
const defaultTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

// ── Form state (covers both create and edit) ────────────────────────
const isCreating = ref(false)
const formTitle = ref('')
const formPrompt = ref('')
const formScheduleKind = ref<ScheduleKind>('once')
const formDueAtLocal = ref('')   // datetime-local string
const formSchedule = ref('')     // cron string
const formTimezone = ref('UTC')

const selected = computed<AgentTask | null>(() => {
  if (selectedId.value === null) return null
  return tasks.value.find((t) => t.id === selectedId.value) ?? null
})

function selectTask(task: AgentTask) {
  selectedId.value = task.id
  isCreating.value = false
  formError.value = null
  actionError.value = null
  mode.value = 'read'
}

function openCreate() {
  selectedId.value = null
  isCreating.value = true
  formTitle.value = ''
  formPrompt.value = ''
  formScheduleKind.value = 'once'
  formDueAtLocal.value = defaultDueAtLocal()
  formSchedule.value = '0 8 * * *'
  formTimezone.value = defaultTimezone
  formError.value = null
  actionError.value = null
  mode.value = 'edit'
}

function openEdit() {
  const task = selected.value
  if (!task) return
  isCreating.value = false
  formTitle.value = task.title
  formPrompt.value = task.prompt
  formTimezone.value = task.timezone
  if (task.schedule) {
    formScheduleKind.value = 'cron'
    formSchedule.value = task.schedule
    formDueAtLocal.value = defaultDueAtLocal()
  } else {
    formScheduleKind.value = 'once'
    formSchedule.value = '0 8 * * *'
    formDueAtLocal.value = task.due_at ? epochToLocalInput(task.due_at) : defaultDueAtLocal()
  }
  formError.value = null
  // A run-now/pause/delete failure on the read view shouldn't linger
  // into the edit view — the user has moved on.
  actionError.value = null
  mode.value = 'edit'
}

function cancelEdit() {
  formError.value = null
  actionError.value = null
  if (isCreating.value) {
    isCreating.value = false
    mode.value = 'empty'
    return
  }
  if (selected.value) {
    mode.value = 'read'
  } else {
    mode.value = 'empty'
  }
}

async function save() {
  if (!formTitle.value.trim()) {
    formError.value = 'Titel ist erforderlich.'
    return
  }
  if (!formPrompt.value.trim()) {
    formError.value = 'Prompt ist erforderlich.'
    return
  }
  let dueAt: number | null = null
  let schedule: string | null = null
  if (formScheduleKind.value === 'once') {
    const epoch = localInputToEpoch(formDueAtLocal.value)
    if (epoch === null) {
      formError.value = 'Bitte einen gültigen Zeitpunkt wählen.'
      return
    }
    dueAt = epoch
  } else {
    if (!formSchedule.value.trim()) {
      formError.value = 'Cron-Ausdruck ist erforderlich.'
      return
    }
    schedule = formSchedule.value.trim()
  }

  saving.value = true
  formError.value = null
  try {
    if (isCreating.value) {
      const body: AgentTaskCreate = {
        title: formTitle.value.trim(),
        prompt: formPrompt.value,
        due_at: dueAt,
        schedule,
        timezone: formTimezone.value,
        enabled: true,
      }
      const created = await create(body)
      selectedId.value = created.id
    } else {
      const task = selected.value
      if (!task) {
        // Task was deleted (here or elsewhere) between openEdit() and
        // Save. Don't silently succeed — surface it so the user knows
        // their change wasn't applied.
        formError.value = 'Task wurde zwischenzeitlich gelöscht.'
        return
      }
      // The two `clear_*` flags always carry the *opposite* mode's clear
      // signal: in `once` mode we clear schedule, in `cron` mode we clear
      // due_at. That covers both same-mode edits (the clear is a harmless
      // no-op on an already-NULL column) and mode switches (the clear is
      // load-bearing). The backend's update() validates that exactly one
      // side is set after the patch.
      const body: AgentTaskUpdate = {
        title: formTitle.value.trim(),
        prompt: formPrompt.value,
        timezone: formTimezone.value,
        clear_due_at: schedule !== null,
        clear_schedule: dueAt !== null,
        due_at: dueAt,
        schedule,
      }
      await patch(task.id, body)
    }
    mode.value = 'read'
  } catch (err: unknown) {
    formError.value =
      err instanceof Error ? err.message : 'Fehler beim Speichern.'
  } finally {
    saving.value = false
  }
}

async function togglePause() {
  const task = selected.value
  if (!task) return
  actionError.value = null
  try {
    // clear_* flags must always be on the wire (FastAPI marks them as
    // required even with a default) — both false for a pause-only patch.
    await patch(task.id, {
      enabled: !task.enabled,
      clear_due_at: false,
      clear_schedule: false,
    })
  } catch (err: unknown) {
    actionError.value =
      err instanceof Error ? err.message : 'Fehler beim Umschalten.'
  }
}

// Number of times to poll the list after `runNow`. The backend runs the
// task in a separate asyncio task; `last_run_at`/`last_status` only lands
// once the agent loop finishes. Without a follow-up poll the user clicks
// Play and sees nothing change — looks broken.
const RUN_NOW_POLL_DELAYS_MS = [1500, 4000]
const pollTimers = new Set<ReturnType<typeof setTimeout>>()

async function onRunNow() {
  const task = selected.value
  if (!task) return
  actionError.value = null
  running.value = true
  try {
    await runNow(task.id)
    await load()
    // Schedule a couple of follow-up reloads so a short-running task's
    // outcome lands on the UI without a manual refresh. Track the timer
    // ids so unmount can cancel them — otherwise the callback fires
    // against an unmounted composable.
    for (const delay of RUN_NOW_POLL_DELAYS_MS) {
      const id = setTimeout(() => {
        pollTimers.delete(id)
        load().catch((err) => {
          // Surface poll failures via the load-error channel rather
          // than swallowing them — a 500 on the list endpoint shouldn't
          // be invisible just because it came from a background reload.
          error.value =
            err instanceof Error ? err.message : 'Fehler beim Neuladen.'
        })
      }, delay)
      pollTimers.add(id)
    }
  } catch (err: unknown) {
    actionError.value =
      err instanceof Error ? err.message : 'Fehler beim Ausführen.'
  } finally {
    running.value = false
  }
}

onBeforeUnmount(() => {
  for (const id of pollTimers) clearTimeout(id)
  pollTimers.clear()
})

async function onRemove() {
  const task = selected.value
  if (!task) return
  const ok = await confirm({
    title: 'Task löschen?',
    description: `"${task.title}" wird endgültig gelöscht.`,
    destructive: true,
  })
  if (!ok) return
  actionError.value = null
  try {
    await remove(task.id)
    selectedId.value = null
    mode.value = 'empty'
  } catch (err: unknown) {
    actionError.value =
      err instanceof Error ? err.message : 'Fehler beim Löschen.'
  }
}

// ── Display helpers ─────────────────────────────────────────────────
function epochToLocalInput(epoch: number): string {
  // <input type="datetime-local"> consumes YYYY-MM-DDTHH:MM in the
  // user's local tz. Truncate seconds — the picker doesn't surface them.
  const d = new Date(epoch * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function localInputToEpoch(value: string): number | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000)
}

function defaultDueAtLocal(): string {
  // Default "10 minutes from now" so the user doesn't accidentally
  // create a task that's already due at submission.
  return epochToLocalInput(Math.floor(Date.now() / 1000) + 600)
}

function formatTimestamp(epoch: number | null): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

function describeSchedule(task: AgentTask): string {
  if (task.schedule) {
    return `${task.schedule} (${task.timezone})`
  }
  return formatTimestamp(task.due_at)
}

function statusDotColor(task: AgentTask): string {
  if (!task.enabled) return 'bg-muted-foreground/40'
  if (task.last_status === 'success') return 'bg-emerald-500'
  if (task.last_status === 'error') return 'bg-destructive'
  if (task.last_status === 'cancelled') return 'bg-amber-500'
  return 'bg-sky-500'
}

onMounted(load)
</script>

<template>
  <div class="flex h-[calc(100vh-9rem)] gap-4">
    <!-- ── Left sidebar: list ──────────────────────────────────── -->
    <aside class="flex w-72 shrink-0 flex-col rounded-md border">
      <header class="flex items-center justify-between gap-2 border-b p-3">
        <div class="flex items-center gap-2">
          <ListChecks class="size-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">Agent tasks</h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Neuer Task"
          @click="openCreate"
        >
          <Plus class="size-4" />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <p
          v-if="loading"
          class="p-3 text-xs text-muted-foreground"
        >
          Lädt…
        </p>
        <p
          v-else-if="error"
          class="p-3 text-xs text-destructive"
        >
          {{ error }}
        </p>
        <p
          v-else-if="tasks.length === 0"
          class="p-3 text-xs text-muted-foreground"
        >
          Noch keine Tasks. „+" oben legt einen an.
        </p>
        <ul v-else class="flex flex-col">
          <li v-for="task in tasks" :key="task.id">
            <button
              type="button"
              :data-testid="`task-item-${task.id}`"
              class="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              :class="
                selectedId === task.id && mode !== 'edit'
                  ? 'bg-muted'
                  : ''
              "
              @click="selectTask(task)"
            >
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="statusDotColor(task)"
                :aria-label="task.enabled ? 'aktiv' : 'pausiert'"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ task.title }}</p>
                <p class="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Repeat v-if="task.schedule" class="size-3" />
                  <Timer v-else class="size-3" />
                  {{ describeSchedule(task) }}
                </p>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <!-- ── Right main view: detail ──────────────────────────────── -->
    <section class="flex min-w-0 flex-1 flex-col rounded-md border">
      <header
        class="flex items-center justify-between gap-2 border-b p-3"
        data-testid="task-detail-header"
      >
        <div class="min-w-0 flex-1">
          <template v-if="mode === 'empty'">
            <h2 class="text-sm font-semibold text-muted-foreground">Tasks</h2>
          </template>
          <template v-else-if="mode === 'edit' && isCreating">
            <h2 class="text-sm font-semibold">Neuer Task</h2>
          </template>
          <template v-else-if="selected">
            <p class="truncate text-sm font-semibold" data-testid="task-detail-title">
              {{ selected.title }}
            </p>
            <p
              v-if="actionError"
              class="truncate text-xs text-destructive"
              data-testid="task-action-error"
            >
              {{ actionError }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              <template v-if="selected.last_run_at">
                Zuletzt: {{ formatTimestamp(selected.last_run_at) }}
                ({{ selected.last_status ?? '—' }})
              </template>
              <template v-else>
                Noch nicht ausgeführt.
              </template>
            </p>
          </template>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <template v-if="mode === 'read' && selected">
            <Button
              size="sm"
              variant="outline"
              :disabled="running"
              aria-label="Jetzt ausführen"
              data-testid="task-run-now"
              @click="onRunNow"
            >
              <Play class="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :aria-label="selected.enabled ? 'Pausieren' : 'Aktivieren'"
              data-testid="task-toggle-enabled"
              @click="togglePause"
            >
              <Pause v-if="selected.enabled" class="size-4" />
              <Play v-else class="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Bearbeiten"
              @click="openEdit"
            >
              <Pencil class="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Löschen"
              data-testid="task-delete"
              @click="onRemove"
            >
              <Trash2 class="size-4" />
            </Button>
          </template>
          <template v-else-if="mode === 'edit'">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Abbrechen"
              @click="cancelEdit"
            >
              <X class="size-4" />
            </Button>
            <Button
              size="sm"
              aria-label="Speichern"
              data-testid="task-save"
              :disabled="saving"
              @click="save"
            >
              <Check class="size-4" />
            </Button>
          </template>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Empty state -->
        <div
          v-if="mode === 'empty'"
          class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
        >
          <ListChecks class="mb-3 size-12 stroke-[1.25]" />
          <p class="text-sm font-medium">Wähle einen Task</p>
          <p class="mt-1 text-xs">
            Einen Task aus der Liste auswählen oder einen neuen anlegen.
          </p>
        </div>

        <!-- Read mode -->
        <div v-else-if="mode === 'read' && selected" class="flex flex-col gap-4">
          <section>
            <h3 class="mb-1 text-xs font-medium text-muted-foreground">Prompt</h3>
            <p class="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
              {{ selected.prompt }}
            </p>
          </section>
          <section>
            <h3 class="mb-1 text-xs font-medium text-muted-foreground">Zeitplan</h3>
            <p class="flex items-center gap-1.5 text-sm">
              <Repeat v-if="selected.schedule" class="size-4" />
              <Timer v-else class="size-4" />
              {{ describeSchedule(selected) }}
            </p>
          </section>
        </div>

        <!-- Edit mode -->
        <form
          v-else-if="mode === 'edit'"
          class="flex flex-col gap-3"
          data-testid="task-edit-form"
          @submit.prevent="save"
        >
          <div class="flex flex-col gap-1">
            <label for="taskTitle" class="text-xs font-medium text-muted-foreground">
              Titel
            </label>
            <Input
              id="taskTitle"
              v-model="formTitle"
              placeholder="z. B. Daily summary"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="taskPrompt" class="text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <Textarea
              id="taskPrompt"
              v-model="formPrompt"
              class="min-h-32 font-mono text-sm"
              spellcheck="false"
              placeholder="Was soll der Agent ausführen?"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-muted-foreground">Modus</label>
            <div class="flex gap-2">
              <label
                class="flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                :class="formScheduleKind === 'once' ? 'border-primary bg-muted/50' : ''"
              >
                <input
                  v-model="formScheduleKind"
                  type="radio"
                  value="once"
                />
                <Timer class="size-4" />
                Einmalig
              </label>
              <label
                class="flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                :class="formScheduleKind === 'cron' ? 'border-primary bg-muted/50' : ''"
              >
                <input
                  v-model="formScheduleKind"
                  type="radio"
                  value="cron"
                />
                <Repeat class="size-4" />
                Wiederkehrend
              </label>
            </div>
          </div>
          <div v-if="formScheduleKind === 'once'" class="flex flex-col gap-1">
            <label for="taskDueAt" class="text-xs font-medium text-muted-foreground">
              Zeitpunkt (lokale Zeit)
            </label>
            <Input
              id="taskDueAt"
              v-model="formDueAtLocal"
              type="datetime-local"
            />
          </div>
          <template v-else>
            <div class="flex flex-col gap-1">
              <label for="taskCron" class="text-xs font-medium text-muted-foreground">
                Cron-Ausdruck (5 Felder)
              </label>
              <Input
                id="taskCron"
                v-model="formSchedule"
                placeholder="0 8 * * *"
                class="font-mono text-sm"
              />
              <p class="text-[11px] text-muted-foreground">
                z. B. <code>0 8 * * *</code> = täglich 08:00, <code>*/15 * * * *</code> = alle 15 Min.
              </p>
            </div>
            <div class="flex flex-col gap-1">
              <label for="taskTz" class="text-xs font-medium text-muted-foreground">
                Zeitzone (IANA)
              </label>
              <Input
                id="taskTz"
                v-model="formTimezone"
                placeholder="UTC"
              />
            </div>
          </template>
          <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>
        </form>
      </div>
    </section>
  </div>
</template>
