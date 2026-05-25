<script setup lang="ts">
import { BadgeCheck, ExternalLink, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import ModelSelect from '~/components/settings/ModelSelect.vue'
import { useLlmCredentials } from '~/composables/useLlmCredentials'
import type {
  LlmCredential,
  LlmCredentialCreate,
  LlmProvider,
} from '~/types/api'

const llm = useLlmCredentials()

const credentials = ref<LlmCredential[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ── Add-API-key form ───────────────────────────────────────────────────
const newProvider = ref<LlmProvider>('anthropic')
const newDisplayName = ref('')
const newApiKey = ref('')
const newBaseUrl = ref('')
const submittingApiKey = ref(false)

const baseUrlRequired = computed(() => newProvider.value === 'custom')

// ── OAuth flow state machine ───────────────────────────────────────────
type OAuthPhase = 'idle' | 'awaiting_code' | 'submitting' | 'done'
const oauthPhase = ref<OAuthPhase>('idle')
const oauthFlowId = ref<number | null>(null)
const oauthUrl = ref<string | null>(null)
const oauthCode = ref('')
const oauthStarting = ref(false)
const oauthPollTimer = ref<ReturnType<typeof setInterval> | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    credentials.value = await llm.list()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

async function addApiKey() {
  const display = newDisplayName.value.trim()
  const key = newApiKey.value.trim()
  const baseUrl = newBaseUrl.value.trim()
  if (!display || !key) return
  if (baseUrlRequired.value && !baseUrl) {
    error.value = '"Custom" provider requires a base URL.'
    return
  }
  const body: LlmCredentialCreate = {
    provider: newProvider.value,
    display_name: display,
    api_key: key,
    base_url: baseUrl || null,
  }
  submittingApiKey.value = true
  error.value = null
  try {
    await llm.createApiKey(body)
    newDisplayName.value = ''
    newApiKey.value = ''
    newBaseUrl.value = ''
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Speichern.'
  } finally {
    submittingApiKey.value = false
  }
}

async function activate(id: number) {
  try {
    await llm.activate(id)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Aktivieren.'
  }
}

async function setModel(cred: LlmCredential, model: string | null) {
  // Optimistic update so the ModelSelect doesn't flicker between picks.
  const previous = cred.model
  cred.model = model
  try {
    await llm.setModel(cred.id, model)
  } catch (err: unknown) {
    cred.model = previous
    error.value = err instanceof Error ? err.message : 'Fehler beim Speichern.'
  }
}

async function remove(cred: LlmCredential) {
  if (!confirm(`"${cred.display_name}" wirklich löschen?`)) return
  try {
    await llm.delete(cred.id)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Löschen.'
  }
}

async function startOAuth() {
  oauthStarting.value = true
  error.value = null
  try {
    const res = await llm.oauthStart()
    oauthFlowId.value = res.id
    oauthUrl.value = res.url
    oauthPhase.value = 'awaiting_code'
    // Auto-open the authorization URL in a new tab.
    if (typeof window !== 'undefined') {
      window.open(res.url, '_blank', 'noopener')
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'OAuth-Start fehlgeschlagen.'
    cancelOAuth()
  } finally {
    oauthStarting.value = false
  }
}

async function submitCode() {
  const id = oauthFlowId.value
  const code = oauthCode.value.trim()
  if (id === null || !code) return
  oauthPhase.value = 'submitting'
  error.value = null
  try {
    await llm.oauthSubmitCode(id, code)
    // Don't flip to 'done' yet — wait for /status to confirm authorized.
    // If the CLI exits 0 but a refresh somehow leaves the row 'expired',
    // pollOAuthStatus surfaces that instead of falsely celebrating.
    pollOAuthStatus()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Code abgelehnt.'
    oauthPhase.value = 'awaiting_code'
  }
}

function pollOAuthStatus() {
  const id = oauthFlowId.value
  if (id === null) return
  if (oauthPollTimer.value) {
    clearInterval(oauthPollTimer.value)
  }
  oauthPollTimer.value = setInterval(async () => {
    try {
      const res = await llm.oauthStatus(id)
      if (res.status === 'authorized') {
        stopPolling()
        oauthPhase.value = 'done'
        await load()
        resetOAuth()
      } else if (res.status === 'expired') {
        stopPolling()
        error.value = 'OAuth-Flow ist expired. Starte neu.'
        oauthPhase.value = 'idle'
        await load()
      }
    } catch (err: unknown) {
      // 404 once the row got deleted by /cancel — stop polling silently.
      stopPolling()
      error.value = err instanceof Error ? err.message : 'Status-Poll fehlgeschlagen.'
    }
  }, 1000)
}

function stopPolling() {
  if (oauthPollTimer.value) {
    clearInterval(oauthPollTimer.value)
    oauthPollTimer.value = null
  }
}

function resetOAuth() {
  oauthPhase.value = 'idle'
  oauthFlowId.value = null
  oauthUrl.value = null
  oauthCode.value = ''
}

async function cancelOAuth() {
  stopPolling()
  const id = oauthFlowId.value
  resetOAuth()
  if (id !== null) {
    try {
      await llm.oauthCancel(id)
    } catch {
      // Best-effort — the row may already be gone (timeout / completed).
    }
    await load()
  }
}

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function modeBadge(c: LlmCredential): string {
  if (c.mode === 'oauth_claude') {
    return c.oauth_status === 'authorized' ? 'OAuth · Claude' : `OAuth · ${c.oauth_status ?? '?'}`
  }
  return 'API Key'
}

/**
 * Pending / expired OAuth rows have no usable ciphertext — activating them
 * leaves the proxy without a token and chat 503s. We block the action in the
 * UI and the backend also rejects with 409, but the badge gives the user a
 * clear "this credential isn't ready" signal.
 */
function isOAuthUnready(c: LlmCredential): boolean {
  return c.mode === 'oauth_claude' && c.oauth_status !== 'authorized'
}

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="text-base font-semibold">LLM-Credentials</h2>
      <p class="text-sm text-muted-foreground">
        Wähle aus, welcher Provider den Hermes-Agent treibt. Nur eine
        Credential ist aktiv.
      </p>
    </div>

    <p v-if="error" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {{ error }}
    </p>

    <!-- ── Liste ─────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">Vorhanden</h2>
      <p v-if="loading" class="text-sm text-muted-foreground">Lädt…</p>
      <p v-else-if="credentials.length === 0" class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Noch keine Credentials. Füge unten einen API-Key hinzu oder starte den Claude-OAuth-Flow.
      </p>
      <div
        v-for="c in credentials"
        :key="c.id"
        class="flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center"
      >
        <BadgeCheck v-if="c.is_active" class="hidden size-4 text-emerald-500 sm:block" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <BadgeCheck v-if="c.is_active" class="size-4 text-emerald-500 sm:hidden" />
            <span class="font-medium">{{ c.display_name }}</span>
            <span class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
              {{ c.provider }}
            </span>
            <span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {{ modeBadge(c) }}
            </span>
            <span v-if="c.is_active" class="text-xs font-medium text-emerald-600">Aktiv</span>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Erstellt {{ formatTimestamp(c.created_at) }}
            <template v-if="c.oauth_authorized_at">
              · Authorisiert {{ formatTimestamp(c.oauth_authorized_at) }}
            </template>
          </p>
          <p v-if="isOAuthUnready(c)" class="mt-1 text-xs text-amber-600">
            OAuth-Flow ist noch nicht abgeschlossen — klicke unten auf
            „OAuth starten“, um den Code-Submit-Schritt erneut zu durchlaufen.
          </p>
          <div class="mt-2 w-full max-w-md">
            <ModelSelect
              :model-value="c.model"
              :credential-id="c.id"
              :disabled="isOAuthUnready(c)"
              @update:model-value="(v) => setModel(c, v)"
            />
          </div>
        </div>
        <Button
          v-if="!c.is_active && !isOAuthUnready(c)"
          size="sm"
          variant="secondary"
          @click="activate(c.id)"
        >
          Aktivieren
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :aria-label="`Credential ${c.display_name} löschen`"
          :title="`Credential ${c.display_name} löschen`"
          @click="remove(c)"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </section>

    <Separator />

    <!-- ── API-Key hinzufügen ───────────────────────────────────────── -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">API-Key hinzufügen</h2>
      <form class="space-y-3" @submit.prevent="addApiKey">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <Label for="provider">Provider</Label>
            <select
              id="provider"
              v-model="newProvider"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
              <option value="google">google</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div class="space-y-1">
            <Label for="display">Display-Name</Label>
            <Input id="display" v-model="newDisplayName" placeholder="z.B. Martin OpenAI" />
          </div>
        </div>
        <div class="space-y-1">
          <Label for="apikey">API-Key</Label>
          <Input id="apikey" v-model="newApiKey" type="password" placeholder="sk-…" autocomplete="off" />
        </div>
        <div class="space-y-1">
          <Label for="baseurl">
            Base-URL
            <span class="text-xs text-muted-foreground">
              ({{ baseUrlRequired ? 'erforderlich' : 'optional — überschreibt Provider-Default' }})
            </span>
          </Label>
          <Input id="baseurl" v-model="newBaseUrl" placeholder="https://my-mirror.example.com/v1" />
        </div>
        <Button type="submit" :disabled="submittingApiKey" size="sm">
          {{ submittingApiKey ? 'Speichere…' : 'Hinzufügen' }}
        </Button>
      </form>
    </section>

    <Separator />

    <!-- ── Claude OAuth ─────────────────────────────────────────────── -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">Claude (OAuth)</h2>

      <div v-if="oauthPhase === 'idle'">
        <p class="text-sm text-muted-foreground">
          Startet <code class="font-mono text-xs">claude auth login --claudeai</code>
          im Backend, öffnet die Authorisierungsseite in einem neuen Tab
          und nimmt den Verification-Code zurück.
        </p>
        <Button class="mt-2" size="sm" :disabled="oauthStarting" @click="startOAuth">
          {{ oauthStarting ? 'Starte…' : 'OAuth starten' }}
        </Button>
      </div>

      <div v-else-if="oauthPhase === 'awaiting_code'" class="space-y-2">
        <p class="text-sm">
          Tab geöffnet — autorisiere bei Anthropic, kopiere den
          Verification-Code und füge ihn unten ein.
        </p>
        <a
          v-if="oauthUrl"
          :href="oauthUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <ExternalLink class="size-3" />
          Tab nochmal öffnen
        </a>
        <form class="flex gap-2" @submit.prevent="submitCode">
          <Input
            v-model="oauthCode"
            placeholder="Verification-Code"
            autocomplete="off"
            class="flex-1"
          />
          <Button type="submit" size="sm" :disabled="!oauthCode.trim()">
            Senden
          </Button>
          <Button type="button" variant="ghost" size="sm" @click="cancelOAuth">
            Abbrechen
          </Button>
        </form>
      </div>

      <div v-else-if="oauthPhase === 'submitting'" class="text-sm text-muted-foreground">
        Verifiziere Code…
      </div>

      <div v-else-if="oauthPhase === 'done'" class="text-sm text-emerald-600">
        Authorisiert. Die Credential erscheint in der Liste oben.
      </div>
    </section>
  </div>
</template>
