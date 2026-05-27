<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, RotateCcw } from 'lucide-vue-next'
import type { Message } from '~/types/api'
import RenderedMarkdown from '~/components/chat/RenderedMarkdown.vue'

const props = defineProps<{
  // `ts` is optional: persisted messages carry it; the in-flight streaming
  // bubble does not.
  message: Pick<Message, 'role' | 'content'> & { ts?: number }
  // When true (set by the page on the latest assistant turn), show a
  // Retry control that regenerates this response.
  canRetry?: boolean
  // Disable the Retry control while another run is in flight.
  retryDisabled?: boolean
  // When true (set by the page on user turns), show an Edit control that
  // rewrites this message and regenerates everything after it.
  canEdit?: boolean
  // Disable the Edit control while another run is in flight.
  editDisabled?: boolean
}>()

const emit = defineEmits<{ retry: []; edit: [content: string] }>()

const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')
// Only assistant prose gets Markdown rendering; user and tool text stay literal.
const isAssistant = computed(() => props.message.role === 'assistant')

const timestamp = computed(() => {
  if (props.message.ts == null) return ''
  return new Date(props.message.ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
})

// Inline edit state. The draft is seeded from the current content each time
// the user opens the editor, so Cancel always restores the original.
const editing = ref(false)
const draft = ref('')

function startEdit() {
  draft.value = props.message.content
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function confirmEdit() {
  const text = draft.value.trim()
  // Mirror the backend's min_length=1 guard — don't fire a no-op regenerate.
  if (!text) return
  editing.value = false
  emit('edit', text)
}
</script>

<template>
  <div
    class="flex w-full flex-col"
    :class="isUser ? 'items-end' : 'items-start'"
  >
    <!-- Inline editor (user turns only) -->
    <div v-if="editing" class="flex w-full max-w-[80%] flex-col gap-1">
      <textarea
        v-model="draft"
        rows="3"
        class="w-full resize-y rounded-2xl border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label="Nachricht bearbeiten"
        @keydown.escape="cancelEdit"
      />
      <p class="text-xs text-muted-foreground">
        Spätere Nachrichten werden neu generiert.
      </p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          @click="cancelEdit"
        >
          Abbrechen
        </button>
        <button
          type="button"
          class="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim()"
          @click="confirmEdit"
        >
          Speichern &amp; neu generieren
        </button>
      </div>
    </div>

    <template v-else>
      <div
        class="max-w-[80%] rounded-2xl px-4 py-2 text-sm break-words"
        :class="{
          'bg-primary text-primary-foreground whitespace-pre-wrap': isUser,
          'bg-muted text-foreground': isAssistant,
          'border border-dashed bg-background text-muted-foreground font-mono text-xs whitespace-pre-wrap': isTool,
        }"
      >
        <span v-if="isTool" class="text-xs uppercase tracking-wider opacity-60 mr-2">
          tool
        </span>
        <RenderedMarkdown v-if="isAssistant" :content="message.content" />
        <template v-else>{{ message.content }}</template>
      </div>
      <span
        v-if="timestamp"
        class="message-ts mt-1 px-1 text-[10px] text-muted-foreground"
      >
        {{ timestamp }}
      </span>
      <button
        v-if="canRetry"
        type="button"
        class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="retryDisabled"
        aria-label="Antwort neu generieren"
        @click="emit('retry')"
      >
        <RotateCcw class="size-3" />
        Neu generieren
      </button>
      <button
        v-if="canEdit"
        type="button"
        class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="editDisabled"
        aria-label="Nachricht bearbeiten"
        @click="startEdit"
      >
        <Pencil class="size-3" />
        Bearbeiten
      </button>
    </template>
  </div>
</template>
