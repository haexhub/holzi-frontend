<script setup lang="ts">
import {
  BadgeCheck,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import { useChannels } from '~/composables/useChannels'
import { useConfirm } from '~/composables/useConfirm'
import { usePersonas } from '~/composables/usePersonas'
import type { ChannelPrompt, Persona } from '~/types/api'

// Plan 29-A /settings/preferences. Two stacked sections:
//   1. Personas — CRUD over `personas`. The single-default invariant
//      is enforced by the backend; the UI just disables the delete
//      button on the default and swaps to "Als Default setzen" on
//      non-defaults.
//   2. Channels — one card per row from `GET /api/channels` (i.e. one
//      per registry entry). Each card has a persona dropdown plus a
//      prompt textarea, and shows a "Reset"-button when the prompt is
//      no longer the channel's `default_prompt`. Driving the cards off
//      the API response means a new backend channel renders without a
//      FE change.

const personasApi = usePersonas()
const channelsApi = useChannels()
const { confirm } = useConfirm()

const personas = ref<Persona[]>([])
const channels = ref<ChannelPrompt[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [pers, chans] = await Promise.all([
      personasApi.list(),
      channelsApi.list(),
    ])
    personas.value = pers.personas
    channels.value = chans.channels
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ────────────────────────────────────────────────────────────────────
// Personas
// ────────────────────────────────────────────────────────────────────

// One inline editor at a time — id of the persona currently in edit
// mode, or 'new' for the "Neue Persona"-form, or null for no editor.
type EditTarget = number | 'new' | null
const editing = ref<EditTarget>(null)
const formName = ref('')
const formPrompt = ref('')
const formIsDefault = ref(false)
const formError = ref<string | null>(null)
const saving = ref(false)

function openCreate() {
  editing.value = 'new'
  formName.value = ''
  formPrompt.value = ''
  formIsDefault.value = false
  formError.value = null
}

function openEdit(persona: Persona) {
  editing.value = persona.id
  formName.value = persona.name
  formPrompt.value = persona.prompt
  formIsDefault.value = persona.is_default
  formError.value = null
}

function cancelEdit() {
  editing.value = null
  formError.value = null
}

function mapPersonaError(err: unknown): string {
  const status = (err as { statusCode?: number; status?: number })
    ?.statusCode
    ?? (err as { status?: number })?.status
  if (status === 409) return 'Name bereits vergeben.'
  if (status === 422) {
    const detail = (
      err as { data?: { detail?: unknown } }
    )?.data?.detail
    if (typeof detail === 'string') return detail
    return 'Eingabe ungültig.'
  }
  return err instanceof Error ? err.message : 'Fehler.'
}

async function submitPersonaForm() {
  const name = formName.value.trim()
  const prompt = formPrompt.value
  if (!name || !prompt.trim()) {
    formError.value = 'Name und Prompt sind erforderlich.'
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editing.value === 'new') {
      await personasApi.create({
        name,
        prompt,
        is_default: formIsDefault.value,
      })
    } else if (typeof editing.value === 'number') {
      await personasApi.update(editing.value, {
        name,
        prompt,
        is_default: formIsDefault.value,
      })
    }
    await load()
    editing.value = null
  } catch (err: unknown) {
    formError.value = mapPersonaError(err)
  } finally {
    saving.value = false
  }
}

async function setDefaultPersona(persona: Persona) {
  error.value = null
  try {
    await personasApi.update(persona.id, { is_default: true })
    await load()
  } catch (err: unknown) {
    error.value = mapPersonaError(err)
  }
}

async function deletePersona(persona: Persona) {
  const ok = await confirm({
    title: 'Persona löschen?',
    description: `"${persona.name}" wird endgültig gelöscht.`,
    destructive: true,
  })
  if (!ok) return
  error.value = null
  try {
    await personasApi.delete(persona.id)
    await load()
  } catch (err: unknown) {
    error.value = mapPersonaError(err)
  }
}

// ────────────────────────────────────────────────────────────────────
// Channels
// ────────────────────────────────────────────────────────────────────

// Per-channel transient state: the textarea binds to a draft prompt and
// the dropdown binds to a draft persona id (null = global default). On
// "Speichern" we diff against the persisted row and only PUT what
// changed; on `load()` we refresh both back to the persisted values.
interface ChannelDraft {
  prompt: string
  // string here because <select> values are strings; "" means "global
  // default" (sent as null) and any other string is the persona id.
  defaultPersonaId: string
  saving: boolean
  error: string | null
}

const channelDrafts = ref<Record<string, ChannelDraft>>({})

function emptyDraft(channel: ChannelPrompt): ChannelDraft {
  return {
    prompt: channel.prompt,
    defaultPersonaId:
      channel.default_persona_id === null
        ? ''
        : String(channel.default_persona_id),
    saving: false,
    error: null,
  }
}

function draftFor(channel: ChannelPrompt): ChannelDraft {
  let draft = channelDrafts.value[channel.channel]
  if (draft === undefined) {
    // Race-safe init: a v-model binding may try to read the draft before
    // the watch below has populated it (template renders synchronously
    // on the first paint while the watch fires in microtask order).
    draft = emptyDraft(channel)
    channelDrafts.value[channel.channel] = draft
  }
  return draft
}

watch(
  channels,
  (next) => {
    const out: Record<string, ChannelDraft> = {}
    for (const c of next) {
      out[c.channel] = emptyDraft(c)
    }
    channelDrafts.value = out
  },
  { immediate: true },
)

function channelDirty(channel: ChannelPrompt): boolean {
  const draft = draftFor(channel)
  const promptChanged = draft.prompt !== channel.prompt
  const personaChanged =
    (draft.defaultPersonaId === '' ? null : Number(draft.defaultPersonaId))
    !== channel.default_persona_id
  return promptChanged || personaChanged
}

async function saveChannel(channel: ChannelPrompt) {
  const draft = draftFor(channel)
  draft.saving = true
  draft.error = null
  try {
    const body: {
      prompt?: string
      default_persona_id?: number | null
    } = {}
    if (draft.prompt !== channel.prompt) body.prompt = draft.prompt
    const wantedPid =
      draft.defaultPersonaId === '' ? null : Number(draft.defaultPersonaId)
    if (wantedPid !== channel.default_persona_id) {
      body.default_persona_id = wantedPid
    }
    await channelsApi.update(channel.channel, body)
    await load()
  } catch (err: unknown) {
    draft.error = mapPersonaError(err)
  } finally {
    draft.saving = false
  }
}

async function resetChannelPrompt(channel: ChannelPrompt) {
  const ok = await confirm({
    title: 'Prompt zurücksetzen?',
    description: `Der Channel-Prompt für „${channel.label}" wird auf den Default zurückgesetzt.`,
    destructive: false,
  })
  if (!ok) return
  const draft = draftFor(channel)
  draft.saving = true
  draft.error = null
  try {
    await channelsApi.reset(channel.channel)
    await load()
  } catch (err: unknown) {
    draft.error = mapPersonaError(err)
  } finally {
    draft.saving = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8" data-testid="preferences-page">
    <header class="flex items-center gap-2">
      <SlidersHorizontal class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">Preferences</h2>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      data-testid="preferences-global-error"
    >
      {{ error }}
    </p>

    <p v-if="loading" class="text-sm text-muted-foreground">Lädt…</p>

    <!-- ── Section 1: Personas ─────────────────────────────────────── -->
    <section
      v-if="!loading"
      class="flex flex-col gap-4"
      data-testid="personas-section"
    >
      <div class="flex items-end justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold">Personas</h3>
          <p class="text-xs text-muted-foreground">
            Wer der Agent ist — Identität und Stil.
          </p>
        </div>
        <Button
          v-if="editing !== 'new'"
          size="sm"
          variant="outline"
          data-testid="personas-new-button"
          @click="openCreate"
        >
          <Plus class="mr-1 size-3.5" /> Neue Persona
        </Button>
      </div>

      <!-- Create form (inline) -->
      <form
        v-if="editing === 'new'"
        class="flex flex-col gap-3 rounded-md border p-4"
        data-testid="personas-create-form"
        @submit.prevent="submitPersonaForm"
      >
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-muted-foreground"
            >Name</label
          >
          <Input
            v-model="formName"
            placeholder="z. B. Hermes der Direkte"
            data-testid="personas-form-name"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-muted-foreground"
            >Prompt (Identität + Stil)</label
          >
          <Textarea
            v-model="formPrompt"
            class="min-h-32 font-mono text-sm"
            spellcheck="false"
            data-testid="personas-form-prompt"
          />
        </div>
        <label class="flex items-center gap-2 text-xs">
          <input
            v-model="formIsDefault"
            type="checkbox"
            data-testid="personas-form-default"
          />
          Als globale Default-Persona setzen
        </label>
        <p
          v-if="formError"
          class="text-sm text-destructive"
          data-testid="personas-form-error"
        >
          {{ formError }}
        </p>
        <div class="flex gap-2">
          <Button size="sm" type="submit" :disabled="saving">
            <Check class="mr-1 size-3.5" /> Speichern
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            @click="cancelEdit"
          >
            <X class="mr-1 size-3.5" /> Abbrechen
          </Button>
        </div>
      </form>

      <!-- Persona cards -->
      <ul class="flex flex-col gap-3">
        <li
          v-for="persona in personas"
          :key="persona.id"
          class="rounded-md border p-4"
          :data-testid="`persona-card-${persona.id}`"
        >
          <!-- Edit form (inline) -->
          <form
            v-if="editing === persona.id"
            class="flex flex-col gap-3"
            data-testid="personas-edit-form"
            @submit.prevent="submitPersonaForm"
          >
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-muted-foreground"
                >Name</label
              >
              <Input v-model="formName" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-muted-foreground"
                >Prompt</label
              >
              <Textarea
                v-model="formPrompt"
                class="min-h-32 font-mono text-sm"
                spellcheck="false"
              />
            </div>
            <label class="flex items-center gap-2 text-xs">
              <input v-model="formIsDefault" type="checkbox" />
              Default-Persona
            </label>
            <p v-if="formError" class="text-sm text-destructive">
              {{ formError }}
            </p>
            <div class="flex gap-2">
              <Button size="sm" type="submit" :disabled="saving">
                <Check class="mr-1 size-3.5" /> Speichern
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                @click="cancelEdit"
              >
                <X class="mr-1 size-3.5" /> Abbrechen
              </Button>
            </div>
          </form>

          <!-- Read view -->
          <div v-else class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-semibold">{{ persona.name }}</h4>
                <span
                  v-if="persona.is_default"
                  class="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  data-testid="persona-default-badge"
                >
                  <BadgeCheck class="size-3" /> Default
                </span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Bearbeiten"
                  :data-testid="`persona-edit-${persona.id}`"
                  @click="openEdit(persona)"
                >
                  <Pencil class="size-4" />
                </Button>
                <Button
                  v-if="!persona.is_default"
                  size="sm"
                  variant="outline"
                  :data-testid="`persona-set-default-${persona.id}`"
                  @click="setDefaultPersona(persona)"
                >
                  Als Default setzen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Löschen"
                  :disabled="persona.is_default"
                  :data-testid="`persona-delete-${persona.id}`"
                  @click="deletePersona(persona)"
                >
                  <Trash2 class="size-4" />
                </Button>
              </div>
            </div>
            <pre
              class="line-clamp-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground"
              >{{ persona.prompt }}</pre>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Section 2: Channels ─────────────────────────────────────── -->
    <section
      v-if="!loading"
      class="flex flex-col gap-4"
      data-testid="channels-section"
    >
      <div>
        <h3 class="text-sm font-semibold">Channels</h3>
        <p class="text-xs text-muted-foreground">
          Wie der Kanal sich verhält — Format, Länge, Ton.
        </p>
      </div>

      <ul class="flex flex-col gap-3">
        <li
          v-for="channel in channels"
          :key="channel.channel"
          class="rounded-md border p-4"
          :data-testid="`channel-card-${channel.channel}`"
        >
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold">{{ channel.label }}</h4>
              <span
                class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >{{ channel.channel }}</span
              >
              <span
                v-if="channel.is_default_prompt"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >Default-Prompt</span
              >
              <span
                v-else
                class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                :data-testid="`channel-custom-badge-${channel.channel}`"
                >Eigener Prompt</span
              >
            </div>

            <div class="flex flex-col gap-1">
              <label
                class="text-xs font-medium text-muted-foreground"
                :for="`persona-select-${channel.channel}`"
                >Default-Persona für diesen Channel</label
              >
              <select
                :id="`persona-select-${channel.channel}`"
                v-model="draftFor(channel).defaultPersonaId"
                class="h-9 rounded-md border bg-background px-2 text-sm"
                :data-testid="`channel-persona-select-${channel.channel}`"
              >
                <option value="">
                  — Globaler Default (is_default-Persona) —
                </option>
                <option
                  v-for="persona in personas"
                  :key="persona.id"
                  :value="String(persona.id)"
                >
                  {{ persona.name }}
                </option>
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label
                class="text-xs font-medium text-muted-foreground"
                :for="`prompt-${channel.channel}`"
                >Channel-Prompt</label
              >
              <Textarea
                :id="`prompt-${channel.channel}`"
                v-model="draftFor(channel).prompt"
                class="min-h-32 font-mono text-sm"
                spellcheck="false"
                :data-testid="`channel-prompt-${channel.channel}`"
              />
            </div>

            <p
              v-if="draftFor(channel).error"
              class="text-sm text-destructive"
              :data-testid="`channel-error-${channel.channel}`"
            >
              {{ draftFor(channel).error }}
            </p>

            <div class="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                :disabled="
                  !channelDirty(channel) || draftFor(channel).saving
                "
                :data-testid="`channel-save-${channel.channel}`"
                @click="saveChannel(channel)"
              >
                <Check class="mr-1 size-3.5" /> Speichern
              </Button>
              <Button
                v-if="!channel.is_default_prompt"
                size="sm"
                variant="ghost"
                :data-testid="`channel-reset-${channel.channel}`"
                @click="resetChannelPrompt(channel)"
              >
                <RotateCcw class="mr-1 size-3.5" /> Prompt zurücksetzen
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
