<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import type { Message } from '~/types/api'

const props = defineProps<{
  message: Pick<Message, 'role' | 'content'>
  // When true (set by the page on the latest assistant turn), show a
  // Retry control that regenerates this response.
  canRetry?: boolean
  // Disable the Retry control while another run is in flight.
  retryDisabled?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')
</script>

<template>
  <div
    class="flex w-full flex-col"
    :class="isUser ? 'items-end' : 'items-start'"
  >
    <div
      class="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words"
      :class="{
        'bg-primary text-primary-foreground': isUser,
        'bg-muted text-foreground': !isUser && !isTool,
        'border border-dashed bg-background text-muted-foreground font-mono text-xs': isTool,
      }"
    >
      <span v-if="isTool" class="text-xs uppercase tracking-wider opacity-60 mr-2">
        tool
      </span>
      {{ message.content }}
    </div>
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
  </div>
</template>
