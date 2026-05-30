<script setup lang="ts">
import { AlertOctagon, Check, Loader2, ShieldAlert, X } from 'lucide-vue-next'
import type { ApprovalDecision } from '~/composables/useChatStream'

// A risky tool call paused for the user's go-ahead. `status` is owned by the
// page: `pending` shows the buttons, `submitting` while the POST is in flight,
// and `allowed`/`denied` once the verdict is in (buttons gone). Decided cards
// stay visible so the conversation keeps a record of what was approved.
//
// Plan 21: the gate now has four decisions (allow_once / allow_session /
// allow_always / deny) plus an optional reason; the latter is collapsed
// behind a "Mit Begründung" link so the routine case stays a single click.
const props = defineProps<{
  approval: {
    name: string
    arguments?: Record<string, unknown> | null
    reason: string
  }
  status: 'pending' | 'submitting' | 'allowed' | 'denied'
}>()

const emit = defineEmits<{
  decide: [{ decision: ApprovalDecision; reason?: string }]
}>()

const hasArguments = computed(() => {
  const a = props.approval.arguments
  return a != null && Object.keys(a).length > 0
})

const prettyArguments = computed(() =>
  hasArguments.value ? JSON.stringify(props.approval.arguments, null, 2) : '',
)

const decided = computed(
  () => props.status === 'allowed' || props.status === 'denied',
)
const busy = computed(() => props.status === 'submitting')

const showReason = ref(false)
const reasonText = ref('')

// Cap mirrors the backend's `Field(max_length=500)` so a too-long paste is
// caught client-side too; the textarea hard-caps via `maxlength`.
const REASON_MAX = 500

function decide(decision: ApprovalDecision) {
  const reason = reasonText.value.trim()
  emit('decide', reason ? { decision, reason } : { decision })
}
</script>

<template>
  <div
    class="w-full max-w-[80%] overflow-hidden rounded-xl border text-xs"
    :class="{
      'border-amber-500/40': status === 'pending' || status === 'submitting',
      'border-emerald-500/40': status === 'allowed',
      'border-destructive/40': status === 'denied',
    }"
  >
    <!-- Header: risk reason -->
    <div
      class="flex items-center gap-2 px-3 py-2"
      :class="{
        'bg-amber-500/10 text-amber-700 dark:text-amber-300':
          status === 'pending' || status === 'submitting',
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':
          status === 'allowed',
        'bg-destructive/10 text-destructive': status === 'denied',
      }"
    >
      <ShieldAlert class="size-4 shrink-0" />
      <span class="font-medium">Bestätigung erforderlich</span>
      <span class="ml-auto inline-flex items-center gap-1 font-medium">
        <Loader2 v-if="status === 'submitting'" class="size-3.5 animate-spin" />
        <Check v-else-if="status === 'allowed'" class="size-3.5" />
        <X v-else-if="status === 'denied'" class="size-3.5" />
        <span v-if="status === 'allowed'">Erlaubt</span>
        <span v-else-if="status === 'denied'">Abgelehnt</span>
      </span>
    </div>

    <!-- Body: what the agent wants to do -->
    <div class="space-y-2 border-t bg-background px-3 py-2">
      <p>{{ approval.reason }}</p>
      <p class="text-muted-foreground">
        Tool: <span class="font-mono font-medium text-foreground">{{ approval.name }}</span>
      </p>
      <div v-if="hasArguments">
        <p class="mb-1 font-medium text-muted-foreground">Argumente</p>
        <pre class="max-h-48 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap break-words">{{ prettyArguments }}</pre>
      </div>

      <!-- Optional reason textarea, collapsed behind a link to keep the
           single-click happy path quick. The trimmed value is sent with
           every decision (deny benefits most; allow_* also accepts it). -->
      <div v-if="!decided">
        <button
          v-if="!showReason"
          type="button"
          class="text-xs underline-offset-2 hover:underline text-muted-foreground"
          :disabled="busy"
          @click="showReason = true"
        >
          Mit Begründung
        </button>
        <div v-else class="space-y-1">
          <label class="block font-medium text-muted-foreground" for="approval-reason-input">
            Begründung (optional)
          </label>
          <textarea
            id="approval-reason-input"
            v-model="reasonText"
            :maxlength="REASON_MAX"
            :disabled="busy"
            rows="2"
            class="w-full resize-y rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Warum? (max. 500 Zeichen) — wird dem Modell auf Ablehnen mitgegeben"
          />
        </div>
      </div>

      <!-- Actions (only while undecided): four primary buttons, destructive
           styling on Ablehnen. `Immer erlauben` carries an AlertOctagon
           icon to signal its weight. -->
      <div v-if="!decided" class="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          class="rounded border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="decide('deny')"
        >
          Ablehnen
        </button>
        <button
          type="button"
          class="rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="decide('allow_once')"
        >
          Einmal erlauben
        </button>
        <button
          type="button"
          class="rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="decide('allow_session')"
        >
          In dieser Session
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="decide('allow_always')"
        >
          <AlertOctagon class="size-3.5" />
          Immer erlauben
        </button>
      </div>
    </div>
  </div>
</template>
