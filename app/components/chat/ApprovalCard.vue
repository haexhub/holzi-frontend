<script setup lang="ts">
import { computed } from 'vue'
import { Check, Loader2, ShieldAlert, X } from 'lucide-vue-next'
import type { ApprovalDecision } from '~/composables/useChatStream'

// A risky tool call paused for the user's go-ahead. `status` is owned by the
// page: `pending` shows the buttons, `submitting` while the POST is in flight,
// and `allowed`/`denied` once the verdict is in (buttons gone). Decided cards
// stay visible so the conversation keeps a record of what was approved.
const props = defineProps<{
  approval: {
    name: string
    arguments?: Record<string, unknown> | null
    reason: string
  }
  status: 'pending' | 'submitting' | 'allowed' | 'denied'
}>()

const emit = defineEmits<{ decide: [ApprovalDecision] }>()

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

      <!-- Actions (only while undecided) -->
      <div v-if="!decided" class="flex justify-end gap-2 pt-1">
        <button
          type="button"
          class="rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="emit('decide', 'deny')"
        >
          Ablehnen
        </button>
        <button
          type="button"
          class="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="emit('decide', 'allow_once')"
        >
          Einmal erlauben
        </button>
      </div>
    </div>
  </div>
</template>
