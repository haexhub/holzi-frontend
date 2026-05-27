<script setup lang="ts">
import { ref } from 'vue'
import { Paperclip, Send, Square } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import AttachmentChip from '~/components/chat/AttachmentChip.vue'

const emit = defineEmits<{
  send: [payload: { text: string; files: File[] }]
  stop: []
}>()

const props = defineProps<{
  streaming?: boolean
  canStop?: boolean
}>()

// Accept the same set the backend allows (text/code/markdown/log + images +
// PDF). This is a UX hint only — the backend re-validates type and size.
const ACCEPT =
  '.txt,.md,.markdown,.log,.json,.yaml,.yml,.csv,.xml,.toml,.ini,.sh,.sql,' +
  '.py,.js,.ts,.tsx,.vue,.css,.html,.rs,.go,.java,.c,.h,.cpp,' +
  'text/*,image/png,image/jpeg,image/gif,image/webp,application/pdf'

const draft = ref('')
const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    files.value = [...files.value, ...Array.from(input.files)]
  }
  // Reset so picking the same file again re-fires change.
  input.value = ''
}

function removeFile(index: number) {
  files.value = files.value.filter((_, i) => i !== index)
}

function submit() {
  const text = draft.value.trim()
  // No streaming guard: while a turn is in flight the page enqueues this
  // send instead of dropping it, so the composer stays usable throughout.
  if (!text) return
  emit('send', { text, files: files.value })
  draft.value = ''
  files.value = []
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
    class="flex flex-col gap-2 border-t bg-background p-3"
    @submit.prevent="submit"
  >
    <!-- Selected-but-not-yet-sent attachments. Removable until send. -->
    <div v-if="files.length" class="flex flex-wrap gap-1.5">
      <AttachmentChip
        v-for="(f, i) in files"
        :key="`${f.name}-${i}`"
        :filename="f.name"
        :content-type="f.type || 'application/octet-stream'"
        :size="f.size"
        removable
        @remove="removeFile(i)"
      />
    </div>

    <div class="flex items-end gap-2">
      <input
        ref="fileInput"
        type="file"
        multiple
        :accept="ACCEPT"
        class="hidden"
        @change="onPick"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        title="Datei anhängen"
        aria-label="Datei anhängen"
        @click="fileInput?.click()"
      >
        <Paperclip class="size-4" />
      </Button>
      <Textarea
        v-model="draft"
        :placeholder="streaming
          ? 'Nächste Nachricht eingeben…  (wird nach der Antwort gesendet)'
          : 'Nachricht an Hermes…  (Enter = senden, Shift+Enter = Zeilenumbruch)'"
        class="min-h-[44px] max-h-40 flex-1 resize-none"
        @keydown="onKeydown"
      />
      <!-- Stop stays reachable for the running turn while the composer below
           it keeps queueing the next message. -->
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
      <Button
        type="submit"
        size="icon"
        :disabled="!draft.trim()"
        :title="streaming ? 'In Warteschlange einreihen' : 'Senden'"
      >
        <Send class="size-4" />
      </Button>
    </div>
  </form>
</template>
