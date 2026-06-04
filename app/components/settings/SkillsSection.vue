<script setup lang="ts">
import {
  AlertTriangle,
  BookOpenText,
  Check,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useConfirm } from '~/composables/useConfirm'
import { useSkills } from '~/composables/useSkills'
import { useToast } from '~/composables/useToast'
import type { Skill, SkillCreate, SkillUpdate } from '~/types/api'

// Plan 33 — Skills section on /settings/skills.
//
// Two-pane layout matching /settings/memory (Plan 15):
//   - Left:  searchable list + "Neuer Skill" button
//   - Right: detail with read mode (RenderedMarkdown body) or edit
//            form (name / description / when_to_use / body_markdown).
// Slug is set on create and immutable thereafter; the backend persists
// `description` and `when_to_use` as discrete columns even though they
// look like frontmatter in the editor.

type Mode = 'empty' | 'read' | 'edit'

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const BODY_SOFT_WARN = 8 * 1024
const BODY_HARD_CAP = 16 * 1024

const skillsApi = useSkills()
const { confirm } = useConfirm()
const toast = useToast()

const selectedId = ref<number | null>(null)
const mode = ref<Mode>('empty')
const search = ref('')

const selectedSkill = computed<Skill | null>(() => {
  if (selectedId.value === null) return null
  const list = skillsApi.data.value?.skills ?? []
  return list.find((s) => s.id === selectedId.value) ?? null
})

const filteredSkills = computed<Skill[]>(() => {
  const list = skillsApi.data.value?.skills ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((s) =>
    [s.slug, s.name, s.description].some((f) =>
      f.toLowerCase().includes(q),
    ),
  )
})

// ── Form state ────────────────────────────────────────────────────────
const isCreating = ref(false)
const formSlug = ref('')
const formName = ref('')
const formDescription = ref('')
const formWhenToUse = ref('')
const formBody = ref('')
const formError = ref<string | null>(null)
const saving = ref(false)

function selectSkill(skill: Skill) {
  selectedId.value = skill.id
  formError.value = null
  isCreating.value = false
  mode.value = 'read'
}

function openCreate() {
  isCreating.value = true
  selectedId.value = null
  formSlug.value = ''
  formName.value = ''
  formDescription.value = ''
  formWhenToUse.value = ''
  formBody.value = ''
  formError.value = null
  mode.value = 'edit'
}

function openEdit() {
  const skill = selectedSkill.value
  if (!skill) return
  isCreating.value = false
  formSlug.value = skill.slug
  formName.value = skill.name
  formDescription.value = skill.description
  formWhenToUse.value = skill.when_to_use ?? ''
  formBody.value = skill.body_markdown
  formError.value = null
  mode.value = 'edit'
}

function cancelEdit() {
  formError.value = null
  if (isCreating.value) {
    isCreating.value = false
    mode.value = 'empty'
    return
  }
  mode.value = selectedSkill.value ? 'read' : 'empty'
}

async function save() {
  const name = formName.value.trim()
  const description = formDescription.value.trim()
  const whenToUse = formWhenToUse.value.trim()
  const body = formBody.value
  if (!name) {
    formError.value = 'Name ist erforderlich.'
    return
  }
  if (!description) {
    formError.value = 'Beschreibung ist erforderlich.'
    return
  }
  if (!body.trim()) {
    formError.value = 'Body darf nicht leer sein.'
    return
  }
  if (body.length > BODY_HARD_CAP) {
    formError.value = `Body darf maximal ${BODY_HARD_CAP} Zeichen lang sein.`
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (isCreating.value) {
      const slug = formSlug.value.trim()
      if (!SLUG_REGEX.test(slug)) {
        formError.value =
          'Slug muss kebab-case sein (a-z0-9, optional Bindestriche, 1–64 Zeichen).'
        saving.value = false
        return
      }
      const payload: SkillCreate = {
        slug,
        name,
        description,
        when_to_use: whenToUse || null,
        body_markdown: body,
      }
      const created = await skillsApi.create(payload)
      selectedId.value = created.id
      isCreating.value = false
      toast.success('Skill angelegt.')
    } else {
      const current = selectedSkill.value
      if (!current) return
      const payload: SkillUpdate = {
        name,
        description,
        when_to_use: whenToUse || null,
        body_markdown: body,
      }
      await skillsApi.update(current.id, payload)
      toast.success('Skill gespeichert.')
    }
    mode.value = 'read'
  } catch (err: unknown) {
    formError.value =
      err instanceof Error ? err.message : 'Fehler beim Speichern.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  const skill = selectedSkill.value
  if (!skill) return
  const ok = await confirm({
    title: 'Skill löschen?',
    description: `"${skill.name}" wird endgültig gelöscht. Personas, die diesen Skill aktiviert haben, verlieren ihn automatisch.`,
    destructive: true,
  })
  if (!ok) return
  try {
    await skillsApi.remove(skill.id)
    selectedId.value = null
    mode.value = 'empty'
    toast.success('Skill gelöscht.')
  } catch (err: unknown) {
    toast.error(
      err instanceof Error ? err.message : 'Fehler beim Löschen.',
    )
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

const bodyLength = computed(() => formBody.value.length)
const bodyAtSoftWarning = computed(
  () => bodyLength.value > BODY_SOFT_WARN,
)

onMounted(() => {
  void skillsApi.list()
})
</script>

<template>
  <section
    id="skills-section"
    class="rounded-md border"
    data-testid="skills-section"
  >
    <header class="border-b p-3">
      <div class="flex items-center gap-2">
        <BookOpenText class="size-4 text-muted-foreground" />
        <h3 class="text-sm font-semibold">Skills</h3>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">
        Wiederverwendbare Prompt-Bausteine. Personas aktivieren einzelne
        Skills auf der
        <NuxtLink to="/settings/preferences" class="underline">Preferences-Seite</NuxtLink>.
      </p>
      <p
        class="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300"
        data-testid="skill-security-notice"
      >
        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
        <span>
          Skill-Inhalte fließen in jeden System-Prompt der
          aktivierenden Personas und sind damit in
          <code class="font-mono">/settings/logs</code> sowie
          <code class="font-mono">/settings/insights</code>
          sichtbar — keine API-Keys oder Geheimnisse hier einfügen.
        </span>
      </p>
    </header>

    <div class="flex min-h-[28rem] gap-0">
      <!-- ── Left: list ───────────────────────────────────────── -->
      <aside class="flex w-72 shrink-0 flex-col border-r">
        <div class="flex items-center justify-between gap-2 border-b p-2">
          <div class="relative flex-1">
            <Search
              class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <UiInput
              v-model="search"
              placeholder="Suchen…"
              class="h-8 pl-7 text-sm"
              aria-label="Skills durchsuchen"
              data-testid="skill-search"
            />
          </div>
          <UiButton
            size="sm"
            variant="ghost"
            aria-label="Neuer Skill"
            data-testid="skill-new"
            @click="openCreate"
          >
            <Plus class="size-4" />
          </UiButton>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <p
            v-if="skillsApi.loading.value && !skillsApi.data.value"
            class="p-3 text-xs text-muted-foreground"
          >
            Lädt…
          </p>
          <p
            v-else-if="skillsApi.error.value"
            class="p-3 text-xs text-destructive"
          >
            {{ skillsApi.error.value }}
          </p>
          <p
            v-else-if="filteredSkills.length === 0"
            class="p-3 text-xs text-muted-foreground"
            data-testid="skills-empty"
          >
            <template v-if="search.trim()">
              Keine Treffer für „{{ search }}".
            </template>
            <template v-else>
              Noch keine Skills.
            </template>
          </p>
          <ul v-else class="flex flex-col">
            <li v-for="skill in filteredSkills" :key="skill.id">
              <button
                type="button"
                :data-testid="`skill-item-${skill.slug}`"
                class="w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                :class="
                  selectedId === skill.id && mode !== 'edit' ? 'bg-muted' : ''
                "
                @click="selectSkill(skill)"
              >
                <p class="font-mono text-xs font-medium">{{ skill.slug }}</p>
                <p class="mt-0.5 truncate text-xs">{{ skill.name }}</p>
                <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {{ skill.description }}
                </p>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <!-- ── Right: detail ────────────────────────────────────── -->
      <section class="flex min-w-0 flex-1 flex-col">
        <header
          class="flex items-center justify-between gap-2 border-b p-3"
          data-testid="skill-detail-header"
        >
          <div class="min-w-0 flex-1">
            <template v-if="mode === 'empty'">
              <h4 class="text-sm font-semibold text-muted-foreground">
                Skill auswählen
              </h4>
            </template>
            <template v-else-if="mode === 'edit' && isCreating">
              <h4 class="text-sm font-semibold">Neuer Skill</h4>
            </template>
            <template v-else-if="selectedSkill">
              <p class="truncate text-sm font-semibold">
                {{ selectedSkill.name }}
              </p>
              <p class="font-mono text-xs text-muted-foreground">
                {{ selectedSkill.slug }} ·
                {{ formatTimestamp(selectedSkill.updated_at) }}
              </p>
            </template>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <template v-if="mode === 'read'">
              <UiButton
                size="sm"
                variant="ghost"
                aria-label="Bearbeiten"
                data-testid="skill-edit"
                @click="openEdit"
              >
                <Pencil class="size-4" />
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                aria-label="Löschen"
                data-testid="skill-delete"
                @click="remove"
              >
                <Trash2 class="size-4" />
              </UiButton>
            </template>
            <template v-else-if="mode === 'edit'">
              <UiButton
                size="sm"
                variant="ghost"
                aria-label="Abbrechen"
                data-testid="skill-cancel"
                @click="cancelEdit"
              >
                <X class="size-4" />
              </UiButton>
              <UiButton
                size="sm"
                aria-label="Speichern"
                :disabled="saving"
                data-testid="skill-save"
                @click="save"
              >
                <Check class="size-4" />
              </UiButton>
            </template>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <!-- Empty state -->
          <div
            v-if="mode === 'empty'"
            class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
            data-testid="skill-empty-state"
          >
            <BookOpenText class="mb-3 size-12 stroke-[1.25]" />
            <p class="text-sm font-medium">Wähle einen Skill</p>
            <p class="mt-1 text-xs">
              Einen Skill aus der Liste auswählen oder einen neuen anlegen.
            </p>
          </div>

          <!-- Read mode -->
          <div
            v-else-if="mode === 'read' && selectedSkill"
            class="flex flex-col gap-4"
          >
            <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-muted-foreground">Beschreibung</dt>
              <dd>{{ selectedSkill.description }}</dd>
              <template v-if="selectedSkill.when_to_use">
                <dt class="text-muted-foreground">Einsatz</dt>
                <dd>{{ selectedSkill.when_to_use }}</dd>
              </template>
            </dl>
            <div class="rounded-md border bg-muted/30 p-3">
              <ChatRenderedMarkdown
                :content="selectedSkill.body_markdown"
                data-testid="skill-detail-body"
              />
            </div>
          </div>

          <!-- Edit mode -->
          <form
            v-else-if="mode === 'edit'"
            class="flex flex-col gap-3"
            data-testid="skill-edit-form"
            @submit.prevent="save"
          >
            <div class="flex flex-col gap-1">
              <label
                for="skillSlug"
                class="text-xs font-medium text-muted-foreground"
              >
                Slug
              </label>
              <UiInput
                id="skillSlug"
                v-model="formSlug"
                :readonly="!isCreating"
                :disabled="!isCreating"
                placeholder="z. B. code-style-typescript"
                class="font-mono text-sm"
                data-testid="skill-form-slug"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="skillName"
                class="text-xs font-medium text-muted-foreground"
              >
                Name
              </label>
              <UiInput
                id="skillName"
                v-model="formName"
                placeholder="z. B. Code Style TypeScript"
                data-testid="skill-form-name"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="skillDescription"
                class="text-xs font-medium text-muted-foreground"
              >
                Beschreibung (kurz)
              </label>
              <UiInput
                id="skillDescription"
                v-model="formDescription"
                placeholder="z. B. Style-Guidelines für TypeScript-Reviews"
                data-testid="skill-form-description"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="skillWhenToUse"
                class="text-xs font-medium text-muted-foreground"
              >
                Wann einsetzen? (optional)
              </label>
              <UiInput
                id="skillWhenToUse"
                v-model="formWhenToUse"
                placeholder="z. B. Bei TypeScript-Code-Reviews"
                data-testid="skill-form-when-to-use"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="skillBody"
                class="text-xs font-medium text-muted-foreground"
              >
                Body (Markdown)
              </label>
              <UiTextarea
                id="skillBody"
                v-model="formBody"
                class="min-h-72 font-mono text-sm"
                spellcheck="false"
                data-testid="skill-form-body"
              />
              <p
                class="text-xs"
                :class="
                  bodyAtSoftWarning
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
                "
                data-testid="skill-form-length"
              >
                {{ bodyLength }} / {{ BODY_HARD_CAP }} Zeichen
                <template v-if="bodyAtSoftWarning">
                  — langer Body, Composition wird groß
                </template>
              </p>
            </div>
            <p
              v-if="formError"
              class="text-sm text-destructive"
              data-testid="skill-form-error"
            >
              {{ formError }}
            </p>
          </form>
        </div>
      </section>
    </div>
  </section>
</template>
