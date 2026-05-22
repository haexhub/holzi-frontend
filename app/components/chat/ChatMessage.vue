<script setup lang="ts">
import type { Message } from '~/types/api'

const props = defineProps<{ message: Pick<Message, 'role' | 'content'> }>()

const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')
</script>

<template>
  <div
    class="flex w-full"
    :class="isUser ? 'justify-end' : 'justify-start'"
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
  </div>
</template>
