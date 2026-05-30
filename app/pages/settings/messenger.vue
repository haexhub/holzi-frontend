<script setup lang="ts">
import { BadgeCheck, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useConfirm } from '~/composables/useConfirm'
import { useMessenger } from '~/composables/useMessenger'
import type { MessengerAccount } from '~/types/api'

// Signal "link-as-secondary-device" UI. The flow:
//
//   1. user clicks "Mit Signal verbinden"
//   2. POST /signal/link/start → server hits signal-cli, streams PNG back
//   3. PNG shows in the page; we start polling /signal/link/poll every
//      ~2s so as soon as the user scans the QR on their primary phone
//      and signal-cli picks up the new number, we materialise the row
//   4. once we spot the new row, stop polling, show "Aktivieren?" CTA
//   5. user activates → backend hot-reloads the worker; UI updates the
//      is_active badge
//
// Telegram is simpler: paste a BotFather token, backend validates +
// stores; same activate/delete plumbing.

const messenger = useMessenger()
const { confirm } = useConfirm()

const accounts = ref<MessengerAccount[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ── QR-link state machine ────────────────────────────────────────────
type LinkPhase = 'idle' | 'awaiting_scan' | 'detected'
const linkPhase = ref<LinkPhase>('idle')
const qrUrl = ref<string | null>(null)
const linkStarting = ref(false)
const knownIdsBeforeLink = ref<Set<number>>(new Set())
const detectedAccount = ref<MessengerAccount | null>(null)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

const signalAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'signal'),
)

const telegramAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'telegram'),
)

// ── Telegram form state ──────────────────────────────────────────────
const telegramTokenInput = ref('')
const telegramCreating = ref(false)
const telegramError = ref<string | null>(null)

async function loadAccounts() {
  loading.value = true
  error.value = null
  try {
    const response = await messenger.list()
    accounts.value = response.accounts
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

function stopPolling() {
  if (pollTimer.value !== null) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

function disposeQr() {
  if (qrUrl.value !== null) {
    URL.revokeObjectURL(qrUrl.value)
    qrUrl.value = null
  }
}

async function startLinkFlow() {
  // Reset any previous attempt state first.
  stopPolling()
  disposeQr()
  detectedAccount.value = null
  linkPhase.value = 'idle'
  error.value = null
  linkStarting.value = true

  // Snapshot existing signal account ids so we can spot the freshly-
  // linked one regardless of who else is in the list. Idempotent poll
  // means re-running while a row already exists doesn't double-create.
  knownIdsBeforeLink.value = new Set(signalAccounts.value.map((a) => a.id))

  try {
    qrUrl.value = await messenger.startSignalLink()
    linkPhase.value = 'awaiting_scan'
    // Start polling immediately + then every 2.5s. The /poll endpoint
    // is cheap (single signal-cli /v1/accounts call + diff vs DB) so a
    // tight cadence keeps the UX snappy.
    await pollOnce()
    pollTimer.value = setInterval(() => {
      void pollOnce()
    }, 2500)
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Starten.'
    linkPhase.value = 'idle'
  } finally {
    linkStarting.value = false
  }
}

async function pollOnce() {
  if (linkPhase.value !== 'awaiting_scan') return
  try {
    const response = await messenger.pollSignalLink()
    accounts.value = response.accounts
    const fresh = signalAccounts.value.find(
      (a) => !knownIdsBeforeLink.value.has(a.id),
    )
    if (fresh) {
      detectedAccount.value = fresh
      linkPhase.value = 'detected'
      stopPolling()
      disposeQr()
    }
  } catch (err: unknown) {
    // Soft-fail individual polls — the next tick retries. Surface only
    // persistent errors via the error banner.
    if (err instanceof Error) error.value = err.message
  }
}

function cancelLink() {
  stopPolling()
  disposeQr()
  detectedAccount.value = null
  linkPhase.value = 'idle'
}

async function activate(account: MessengerAccount) {
  try {
    await messenger.activate(account.id)
    await loadAccounts()
    // If the user just confirmed the freshly-linked account, drop the
    // detection state so the regular list takes over.
    if (detectedAccount.value?.id === account.id) {
      detectedAccount.value = null
      linkPhase.value = 'idle'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Aktivieren.'
  }
}

async function removeAccount(account: MessengerAccount) {
  const label =
    account.phone_number ?? account.bot_username ?? String(account.id)
  const ok = await confirm({
    title: 'Account entfernen?',
    description: `Account ${label} wird entfernt.`,
    destructive: true,
  })
  if (!ok) return
  try {
    await messenger.deleteAccount(account.id)
    await loadAccounts()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Löschen.'
  }
}

async function createTelegramAccount() {
  const token = telegramTokenInput.value.trim()
  if (!token) return
  telegramCreating.value = true
  telegramError.value = null
  try {
    await messenger.createTelegram({ bot_token: token })
    telegramTokenInput.value = ''
    await loadAccounts()
  } catch (err: unknown) {
    // 400 from the backend means getMe rejected the token; surface the
    // raw message so the user sees "invalid bot token: Unauthorized" or
    // similar instead of a generic "Fehler".
    const status = (err as { statusCode?: number })?.statusCode
    const data = (err as { data?: { detail?: string } })?.data
    telegramError.value =
      data?.detail ?? (err instanceof Error ? err.message : 'Fehler beim Anlegen.')
    if (status !== 400) {
      // Non-validation errors land in the top-level error banner too —
      // helps spot transport/auth issues that aren't token-specific.
      error.value = telegramError.value
    }
  } finally {
    telegramCreating.value = false
  }
}

onMounted(() => {
  void loadAccounts()
})

onBeforeUnmount(() => {
  stopPolling()
  disposeQr()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="text-base font-semibold">Messenger</h2>
      <p class="text-sm text-muted-foreground">
        Verbinde Messenger, über die du den Agent ansprichst. Aktuell
        unterstützt: Signal, Telegram.
      </p>
    </div>

    <p
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </p>

    <!-- ── Signal section ───────────────────────────────────────────── -->
    <section class="space-y-3">
      <header class="flex items-center justify-between">
        <h3 class="text-sm font-semibold uppercase text-muted-foreground">
          Signal
        </h3>
        <Button
          v-if="linkPhase === 'idle'"
          size="sm"
          variant="outline"
          :disabled="linkStarting"
          @click="startLinkFlow"
        >
          {{ linkStarting ? 'Lade QR…' : 'Mit Signal verbinden' }}
        </Button>
      </header>

      <!-- QR + Wait-for-Scan card -->
      <div
        v-if="linkPhase === 'awaiting_scan' && qrUrl"
        class="rounded-lg border p-4"
      >
        <p class="mb-3 text-sm">
          Öffne Signal auf deinem Hauptgerät, gehe zu
          <strong>Einstellungen → Verknüpfte Geräte → Gerät verknüpfen</strong>
          und scanne diesen QR-Code:
        </p>
        <div class="flex flex-col items-center gap-3">
          <img
            :src="qrUrl"
            alt="Signal-Linking-QR"
            class="size-64 rounded bg-white p-3"
          >
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCcw class="size-4 animate-spin" />
            Warte auf Bestätigung vom Hauptgerät…
          </div>
          <Button size="sm" variant="ghost" @click="cancelLink">
            Abbrechen
          </Button>
        </div>
      </div>

      <!-- Detected: ask for activation -->
      <div
        v-if="linkPhase === 'detected' && detectedAccount"
        class="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4"
      >
        <p class="mb-3 text-sm">
          Verknüpft mit
          <strong>{{ detectedAccount.phone_number }}</strong>. Aktivieren, damit
          der Agent eingehende Nachrichten beantwortet?
        </p>
        <div class="flex gap-2">
          <Button size="sm" @click="activate(detectedAccount)">
            Aktivieren
          </Button>
          <Button size="sm" variant="ghost" @click="cancelLink">
            Später
          </Button>
        </div>
      </div>

      <!-- Account list -->
      <div v-if="loading" class="text-sm text-muted-foreground">Lädt…</div>
      <div
        v-else-if="signalAccounts.length === 0 && linkPhase === 'idle'"
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        Noch kein Signal-Account verknüpft.
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="account in signalAccounts"
          :key="account.id"
          class="flex items-center justify-between rounded-lg border p-3"
        >
          <div class="flex items-center gap-3">
            <BadgeCheck
              v-if="account.is_active"
              class="size-5 text-emerald-500"
              aria-label="Aktiv"
            />
            <div>
              <div class="font-medium">{{ account.phone_number }}</div>
              <div class="text-xs text-muted-foreground">
                {{ account.is_active ? 'Aktiv' : 'Inaktiv' }} · seit
                {{ new Date(account.created_at * 1000).toLocaleDateString() }}
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <Button
              v-if="!account.is_active"
              size="sm"
              variant="outline"
              @click="activate(account)"
            >
              Aktivieren
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :aria-label="`${account.phone_number} entfernen`"
              @click="removeAccount(account)"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Telegram section ────────────────────────────────────────── -->
    <section class="space-y-3">
      <header>
        <h3 class="text-sm font-semibold uppercase text-muted-foreground">
          Telegram
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          Erstelle einen Bot bei
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            class="underline"
          >@BotFather</a>
          und füge hier den Token (Format
          <code class="rounded bg-muted px-1 py-0.5">123456:ABC-DEF…</code>)
          ein.
        </p>
      </header>

      <!-- Token form -->
      <form
        class="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
        @submit.prevent="createTelegramAccount"
      >
        <input
          v-model="telegramTokenInput"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Bot-Token"
          aria-label="Telegram Bot-Token"
          class="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          :disabled="telegramCreating"
        >
        <Button
          type="submit"
          size="sm"
          :disabled="telegramCreating || !telegramTokenInput.trim()"
        >
          {{ telegramCreating ? 'Prüfe…' : 'Hinzufügen' }}
        </Button>
      </form>
      <p
        v-if="telegramError"
        class="text-sm text-destructive"
      >
        {{ telegramError }}
      </p>

      <!-- Account list -->
      <div v-if="loading" class="text-sm text-muted-foreground">Lädt…</div>
      <div
        v-else-if="telegramAccounts.length === 0"
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        Noch kein Telegram-Bot verknüpft.
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="account in telegramAccounts"
          :key="account.id"
          class="flex items-center justify-between rounded-lg border p-3"
        >
          <div class="flex items-center gap-3">
            <BadgeCheck
              v-if="account.is_active"
              class="size-5 text-emerald-500"
              aria-label="Aktiv"
            />
            <div>
              <div class="font-medium">@{{ account.bot_username }}</div>
              <div class="text-xs text-muted-foreground">
                {{ account.is_active ? 'Aktiv' : 'Inaktiv' }} · seit
                {{ new Date(account.created_at * 1000).toLocaleDateString() }}
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <Button
              v-if="!account.is_active"
              size="sm"
              variant="outline"
              @click="activate(account)"
            >
              Aktivieren
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :aria-label="`@${account.bot_username} entfernen`"
              @click="removeAccount(account)"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
