<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '~/composables/useApi'
import type { Note, NoteCreate } from '~/types/api'

const api = useApi()
const notes = ref<Note[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const newKey = ref('')
const newContent = ref('')

async function load() {
  loading.value = true
  error.value = null
  try {
    notes.value = await api.get<Note[]>('/api/notes')
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

async function add() {
  const key = newKey.value.trim()
  const content = newContent.value.trim()
  if (!key || !content) return
  const body: NoteCreate = { key, content, tags: [] }
  try {
    await api.post('/api/notes', body)
    newKey.value = ''
    newContent.value = ''
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Speichern.'
  }
}

async function remove(key: string) {
  try {
    await api.delete(`/api/notes/${encodeURIComponent(key)}`)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Löschen.'
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b p-3">
      <h3 class="text-sm font-semibold">Notes</h3>
    </div>
    <div class="flex-1 space-y-2 overflow-y-auto p-3">
      <p v-if="loading" class="text-sm text-muted-foreground">Lädt…</p>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
      <p v-else-if="notes.length === 0" class="text-sm text-muted-foreground">
        Noch keine Notes.
      </p>
      <div
        v-for="n in notes"
        :key="n.id"
        class="rounded-md border p-3 text-sm"
      >
        <div class="flex items-start justify-between gap-2">
          <code class="font-mono text-xs text-muted-foreground">{{ n.key }}</code>
          <Button size="sm" variant="ghost" @click="remove(n.key)">
            <Trash2 class="size-3.5" />
          </Button>
        </div>
        <p class="mt-1 whitespace-pre-wrap break-words">{{ n.content }}</p>
      </div>
    </div>
    <form class="space-y-2 border-t p-3" @submit.prevent="add">
      <Input v-model="newKey" placeholder="key (z.B. project.holzi.status)" />
      <Textarea v-model="newContent" placeholder="content" class="min-h-[60px]" />
      <Button type="submit" size="sm" class="w-full">Speichern</Button>
    </form>
  </div>
</template>
