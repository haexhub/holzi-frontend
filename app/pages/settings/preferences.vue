<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Check,
  Languages,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  ChannelPrompt,
  Persona,
  PersonaSkillItem,
  Skill,
  SkillListResponse,
} from '~/types/api'

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
const skillsApi = useSkills()
const { confirm } = useConfirm()
// useScope: 'global' is required so `setLocale` is the @nuxtjs/i18n-
// augmented method (does router navigation + cookie persistence). The
// composition-API default scope returns a *local* composer that has no
// setLocale — calling it would silently noop.
const { locale, setLocale } = useI18n({ useScope: 'global' })

// Plan 30 Wave 0 — Sprach-Picker section. Locale is persisted via the
// i18n-cookie (configured in nuxt.config); when Wave C (multi-user)
// lands this moves into per-user preferences.
type SupportedLocale = 'de' | 'en'
const SUPPORTED_LOCALES: { code: SupportedLocale; key: string }[] = [
  { code: 'de', key: 'pages.preferences.language.options.de' },
  { code: 'en', key: 'pages.preferences.language.options.en' },
]
async function onLocaleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as SupportedLocale
  await setLocale(value)
}

const personas = ref<Persona[]>([])
const channels = ref<ChannelPrompt[]>([])
const allSkills = ref<Skill[]>([])
// Per-persona activation list, keyed by persona.id. Loaded after the
// personas list so the cards can populate immediately on the first
// render of the page.
const personaSkills = ref<Record<number, PersonaSkillItem[]>>({})
const loading = ref(false)
const error = ref<string | null>(null)

async function loadPersonaSkillLists(rows: Persona[]): Promise<void> {
  const lists = await Promise.all(
    rows.map(async (p) => {
      const resp = await skillsApi.listForPersona(p.id)
      return [p.id, resp.skills] as const
    }),
  )
  const next: Record<number, PersonaSkillItem[]> = {}
  for (const [id, items] of lists) next[id] = items
  personaSkills.value = next
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [pers, chans, sk] = await Promise.all([
      personasApi.list(),
      channelsApi.list(),
      skillsApi.list().then(
        () => skillsApi.data.value ?? { skills: [] } satisfies SkillListResponse,
      ),
    ])
    personas.value = pers.personas
    channels.value = chans.channels
    allSkills.value = sk.skills
    await loadPersonaSkillLists(pers.personas)
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
// Guards the "Als Default setzen" + "Löschen" buttons against double-
// clicks — those mutations don't go through the form (no `saving`
// flag) so they need their own latch. Held for the whole request +
// its trailing `load()`.
const personaMutating = ref(false)

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
  if (personaMutating.value) return
  personaMutating.value = true
  error.value = null
  try {
    await personasApi.update(persona.id, { is_default: true })
    await load()
  } catch (err: unknown) {
    error.value = mapPersonaError(err)
  } finally {
    personaMutating.value = false
  }
}

async function deletePersona(persona: Persona) {
  if (personaMutating.value) return
  const ok = await confirm({
    title: 'Persona löschen?',
    description: `"${persona.name}" wird endgültig gelöscht.`,
    destructive: true,
  })
  if (!ok) return
  personaMutating.value = true
  error.value = null
  try {
    await personasApi.delete(persona.id)
    await load()
  } catch (err: unknown) {
    error.value = mapPersonaError(err)
  } finally {
    personaMutating.value = false
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

// Preserve in-flight channel-draft edits across reloads. A persona
// mutation (set-default, delete) reloads both lists; without this
// merge, the unconditional reseed would silently wipe an unsaved
// channel-prompt edit. Heuristic: if the existing draft equals what
// was persisted just before this fire, it's untouched → reseed to the
// new server value. Otherwise the user has uncommitted edits → keep
// the draft as-is. Single-user app, so an external mutation on the
// same channel mid-edit is not a real scenario.
function isPersisted(draft: ChannelDraft, channel: ChannelPrompt): boolean {
  const persistedId =
    channel.default_persona_id === null
      ? ''
      : String(channel.default_persona_id)
  return (
    draft.prompt === channel.prompt
    && draft.defaultPersonaId === persistedId
  )
}

watch(
  channels,
  (next, prev) => {
    const prevByKey = new Map(
      (prev ?? []).map((c) => [c.channel, c] as const),
    )
    const merged: Record<string, ChannelDraft> = {}
    for (const c of next) {
      const existing = channelDrafts.value[c.channel]
      const prior = prevByKey.get(c.channel)
      // Preserve only when the draft existed AND it's still in sync
      // with the prior persisted snapshot — anything else means the
      // user has edits (or this is the first paint).
      if (existing !== undefined && prior !== undefined && !isPersisted(existing, prior)) {
        merged[c.channel] = existing
      } else {
        merged[c.channel] = emptyDraft(c)
      }
    }
    channelDrafts.value = merged
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

// ────────────────────────────────────────────────────────────────────
// Persona-skill activation (Plan 33)
// ────────────────────────────────────────────────────────────────────

// Per-persona pending mutation guard so the UI can disable buttons
// while the PUT is in flight. Keyed by persona.id.
const personaSkillsMutating = ref<Record<number, boolean>>({})

function skillsForPersona(personaId: number): PersonaSkillItem[] {
  return personaSkills.value[personaId] ?? []
}

function availableSkillsFor(personaId: number): Skill[] {
  const activeIds = new Set(
    skillsForPersona(personaId).map((it) => it.skill.id),
  )
  return allSkills.value.filter((s) => !activeIds.has(s.id))
}

function itemsToSetPayload(
  items: PersonaSkillItem[],
): { skill_id: number; ordering: number; enabled: boolean }[] {
  return items.map((it, idx) => ({
    skill_id: it.skill.id,
    ordering: idx,
    enabled: it.enabled,
  }))
}

async function persistPersonaSkills(
  personaId: number,
  items: PersonaSkillItem[],
): Promise<void> {
  if (personaSkillsMutating.value[personaId]) return
  personaSkillsMutating.value[personaId] = true
  // Pessimistic update: we send `items` to the server and only swap
  // local state to the server response on success. A failed PUT leaves
  // `personaSkills.value[personaId]` untouched, so the UI snaps back to
  // the pre-mutation list — no manual revert needed.
  try {
    const resp = await skillsApi.setForPersona(
      personaId,
      itemsToSetPayload(items),
    )
    personaSkills.value[personaId] = resp.skills
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : 'Fehler beim Aktualisieren der Skills.'
  } finally {
    personaSkillsMutating.value[personaId] = false
  }
}

async function addSkillToPersona(personaId: number, skillIdRaw: string) {
  if (!skillIdRaw) return
  const skillId = Number(skillIdRaw)
  const skill = allSkills.value.find((s) => s.id === skillId)
  if (!skill) return
  const current = skillsForPersona(personaId)
  const next: PersonaSkillItem[] = [
    ...current,
    { skill, ordering: current.length, enabled: true },
  ]
  await persistPersonaSkills(personaId, next)
}

async function removeSkillFromPersona(personaId: number, skillId: number) {
  const next = skillsForPersona(personaId).filter(
    (it) => it.skill.id !== skillId,
  )
  await persistPersonaSkills(personaId, next)
}

async function togglePersonaSkill(personaId: number, skillId: number) {
  const next = skillsForPersona(personaId).map((it) =>
    it.skill.id === skillId ? { ...it, enabled: !it.enabled } : it,
  )
  await persistPersonaSkills(personaId, next)
}

async function moveSkill(
  personaId: number,
  skillId: number,
  direction: -1 | 1,
) {
  const current = skillsForPersona(personaId)
  const idx = current.findIndex((it) => it.skill.id === skillId)
  if (idx === -1) return
  const target = idx + direction
  if (target < 0 || target >= current.length) return
  const next = current.slice()
  ;[next[idx], next[target]] = [next[target], next[idx]] as [
    PersonaSkillItem,
    PersonaSkillItem,
  ]
  await persistPersonaSkills(personaId, next)
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

    <!-- ── Section 1: Sprache / Language (Plan 30) ─────────────────── -->
    <!-- Picker comes first so a user landing on `/settings/preferences`
         in the wrong locale can switch before reading anything else. -->
    <section class="flex flex-col gap-4" data-testid="language-section">
      <div class="flex items-center gap-2">
        <Languages class="size-4 text-muted-foreground" />
        <div>
          <h3 class="text-sm font-semibold">
            {{ $t('pages.preferences.language.title') }}
          </h3>
          <p class="text-xs text-muted-foreground">
            {{ $t('pages.preferences.language.description') }}
          </p>
        </div>
      </div>
      <div class="flex max-w-xs flex-col gap-1">
        <label
          for="language-select"
          class="text-xs font-medium text-muted-foreground"
        >
          {{ $t('pages.preferences.language.label') }}
        </label>
        <select
          id="language-select"
          class="h-9 rounded-md border bg-background px-2 text-sm"
          :value="locale"
          data-testid="language-select"
          @change="onLocaleChange"
        >
          <option
            v-for="opt in SUPPORTED_LOCALES"
            :key="opt.code"
            :value="opt.code"
          >
            {{ $t(opt.key) }}
          </option>
        </select>
      </div>
    </section>

    <!-- ── Section 2: Personas ─────────────────────────────────────── -->
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
        <UiButton
          v-if="editing !== 'new'"
          size="sm"
          variant="outline"
          data-testid="personas-new-button"
          @click="openCreate"
        >
          <Plus class="mr-1 size-3.5" /> Neue Persona
        </UiButton>
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
          <UiInput
            v-model="formName"
            placeholder="z. B. Hermes der Direkte"
            data-testid="personas-form-name"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-muted-foreground"
            >Prompt (Identität + Stil)</label
          >
          <UiTextarea
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
          <UiButton size="sm" type="submit" :disabled="saving">
            <Check class="mr-1 size-3.5" /> Speichern
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            type="button"
            @click="cancelEdit"
          >
            <X class="mr-1 size-3.5" /> Abbrechen
          </UiButton>
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
              <UiInput v-model="formName" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-muted-foreground"
                >Prompt</label
              >
              <UiTextarea
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
              <UiButton size="sm" type="submit" :disabled="saving">
                <Check class="mr-1 size-3.5" /> Speichern
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                type="button"
                @click="cancelEdit"
              >
                <X class="mr-1 size-3.5" /> Abbrechen
              </UiButton>
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
                <UiButton
                  size="sm"
                  variant="ghost"
                  aria-label="Bearbeiten"
                  :data-testid="`persona-edit-${persona.id}`"
                  @click="openEdit(persona)"
                >
                  <Pencil class="size-4" />
                </UiButton>
                <UiButton
                  v-if="!persona.is_default"
                  size="sm"
                  variant="outline"
                  :disabled="personaMutating"
                  :data-testid="`persona-set-default-${persona.id}`"
                  @click="setDefaultPersona(persona)"
                >
                  Als Default setzen
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  aria-label="Löschen"
                  :disabled="persona.is_default || personaMutating"
                  :data-testid="`persona-delete-${persona.id}`"
                  @click="deletePersona(persona)"
                >
                  <Trash2 class="size-4" />
                </UiButton>
              </div>
            </div>
            <pre
              class="line-clamp-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground"
              >{{ persona.prompt }}</pre>

            <!-- ── Persona-Skill activation (Plan 33) ─────────── -->
            <div
              class="mt-3 border-t pt-3"
              :data-testid="`persona-skills-block-${persona.id}`"
            >
              <div class="mb-2 flex items-center justify-between gap-2">
                <h5 class="text-xs font-semibold text-muted-foreground">
                  Aktive Skills
                </h5>
                <span
                  v-if="skillsForPersona(persona.id).length === 0"
                  class="text-xs text-muted-foreground"
                  :data-testid="`persona-skills-empty-${persona.id}`"
                >
                  keine Skills aktiv
                </span>
              </div>
              <ul
                v-if="skillsForPersona(persona.id).length > 0"
                class="mb-2 flex flex-col gap-1"
              >
                <li
                  v-for="(item, idx) in skillsForPersona(persona.id)"
                  :key="item.skill.id"
                  class="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs"
                  :data-testid="`persona-skill-${persona.id}-${item.skill.slug}`"
                >
                  <label
                    class="flex items-center gap-1.5"
                    :title="
                      item.enabled
                        ? 'Aktiv — fließt in den System-Prompt'
                        : 'Deaktiviert — bleibt verknüpft, ohne in den Prompt zu fließen'
                    "
                  >
                    <input
                      type="checkbox"
                      :checked="item.enabled"
                      :disabled="personaSkillsMutating[persona.id]"
                      :data-testid="`persona-skill-toggle-${persona.id}-${item.skill.slug}`"
                      @change="togglePersonaSkill(persona.id, item.skill.id)"
                    />
                  </label>
                  <span class="flex-1 truncate">
                    <span class="font-mono">{{ item.skill.slug }}</span>
                    <span class="text-muted-foreground"> — {{ item.skill.name }}</span>
                  </span>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 p-0"
                    aria-label="Nach oben verschieben"
                    :disabled="idx === 0 || personaSkillsMutating[persona.id]"
                    :data-testid="`persona-skill-up-${persona.id}-${item.skill.slug}`"
                    @click="moveSkill(persona.id, item.skill.id, -1)"
                  >
                    <ArrowUp class="size-3.5" />
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 p-0"
                    aria-label="Nach unten verschieben"
                    :disabled="
                      idx === skillsForPersona(persona.id).length - 1
                        || personaSkillsMutating[persona.id]
                    "
                    :data-testid="`persona-skill-down-${persona.id}-${item.skill.slug}`"
                    @click="moveSkill(persona.id, item.skill.id, 1)"
                  >
                    <ArrowDown class="size-3.5" />
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 p-0"
                    aria-label="Skill entfernen"
                    :disabled="personaSkillsMutating[persona.id]"
                    :data-testid="`persona-skill-remove-${persona.id}-${item.skill.slug}`"
                    @click="removeSkillFromPersona(persona.id, item.skill.id)"
                  >
                    <X class="size-3.5" />
                  </UiButton>
                </li>
              </ul>
              <div
                v-if="availableSkillsFor(persona.id).length > 0"
                class="flex items-center gap-2"
              >
                <select
                  class="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
                  :disabled="personaSkillsMutating[persona.id]"
                  :data-testid="`persona-skill-add-${persona.id}`"
                  @change="
                    addSkillToPersona(
                      persona.id,
                      ($event.target as HTMLSelectElement).value,
                    );
                    ($event.target as HTMLSelectElement).value = ''
                  "
                >
                  <option value="">+ Skill hinzufügen…</option>
                  <option
                    v-for="skill in availableSkillsFor(persona.id)"
                    :key="skill.id"
                    :value="String(skill.id)"
                  >
                    {{ skill.name }} ({{ skill.slug }})
                  </option>
                </select>
              </div>
              <p
                v-else-if="allSkills.length > 0"
                class="text-xs text-muted-foreground"
              >
                Alle vorhandenen Skills sind bereits hinzugefügt.
              </p>
              <p
                v-else
                class="text-xs text-muted-foreground"
              >
                Noch keine Skills angelegt —
                <NuxtLink to="/settings/skills" class="underline"
                  >Skill anlegen</NuxtLink
                >.
              </p>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Section 3: Channels ─────────────────────────────────────── -->
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
              <UiTextarea
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
              <UiButton
                size="sm"
                :disabled="
                  !channelDirty(channel) || draftFor(channel).saving
                "
                :data-testid="`channel-save-${channel.channel}`"
                @click="saveChannel(channel)"
              >
                <Check class="mr-1 size-3.5" /> Speichern
              </UiButton>
              <UiButton
                v-if="!channel.is_default_prompt"
                size="sm"
                variant="ghost"
                :data-testid="`channel-reset-${channel.channel}`"
                @click="resetChannelPrompt(channel)"
              >
                <RotateCcw class="mr-1 size-3.5" /> Prompt zurücksetzen
              </UiButton>
            </div>
          </div>
        </li>
      </ul>
    </section>

  </div>
</template>
