<script setup lang="ts">
import { MessageSquarePlus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { Conversation } from '~/types/api'

const props = defineProps<{
  conversations: Conversation[]
  activeId: number | null
}>()

const emit = defineEmits<{
  select: [id: number]
  'new-chat': []
}>()

function fmt(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b p-3">
      <h2 class="text-sm font-semibold">Konversationen</h2>
      <Button size="sm" variant="ghost" @click="emit('new-chat')">
        <MessageSquarePlus class="mr-1 size-4" />
        Neu
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto p-2 space-y-1">
      <p
        v-if="props.conversations.length === 0"
        class="px-2 py-4 text-center text-sm text-muted-foreground"
      >
        Keine Konversationen.
      </p>
      <button
        v-for="c in props.conversations"
        :key="c.id"
        type="button"
        class="block w-full rounded-md px-3 py-2 text-left text-sm transition-colors"
        :class="
          c.id === props.activeId
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted'
        "
        @click="emit('select', c.id)"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="truncate font-medium">
            {{ c.title || `${c.channel} #${c.id}` }}
          </span>
          <span class="shrink-0 text-xs text-muted-foreground">
            {{ fmt(c.updated_at) }}
          </span>
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="rounded bg-secondary px-1.5 py-0.5">{{ c.channel }}</span>
          <span v-if="c.message_count !== undefined">
            {{ c.message_count }} Msg
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
