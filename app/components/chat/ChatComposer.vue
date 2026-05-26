<script setup lang="ts">
import { Send, Square } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const props = defineProps<{
  streaming?: boolean
  canStop?: boolean
}>()

const draft = ref('')

function submit() {
  const text = draft.value.trim()
  if (!text || props.streaming) return
  emit('send', text)
  draft.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <form
    class="flex items-end gap-2 border-t bg-background p-3"
    @submit.prevent="submit"
  >
    <Textarea
      v-model="draft"
      placeholder="Nachricht an Hermes…  (Enter = senden, Shift+Enter = Zeilenumbruch)"
      class="min-h-[44px] max-h-40 flex-1 resize-none"
      :disabled="streaming"
      @keydown="onKeydown"
    />
    <Button
      v-if="streaming"
      type="button"
      size="icon"
      variant="destructive"
      :disabled="!canStop"
      :title="canStop ? 'Antwort abbrechen' : 'Antwort wird vorbereitet…'"
      aria-label="Antwort abbrechen"
      @click="emit('stop')"
    >
      <Square class="size-4 fill-current" />
    </Button>
    <Button v-else type="submit" size="icon" :disabled="!draft.trim()">
      <Send class="size-4" />
    </Button>
  </form>
</template>
