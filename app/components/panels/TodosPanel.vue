<script setup lang="ts">
import { Check, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApi } from '~/composables/useApi'
import type { Todo, TodoCreate, TodoUpdate } from '~/types/api'

const api = useApi()
const todos = ref<Todo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const newContent = ref('')

async function load() {
  loading.value = true
  error.value = null
  try {
    todos.value = await api.get<Todo[]>('/api/todos', { only_open: true })
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

async function add() {
  const content = newContent.value.trim()
  if (!content) return
  const body: TodoCreate = { content, tags: [] }
  try {
    await api.post('/api/todos', body)
    newContent.value = ''
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Speichern.'
  }
}

async function markDone(id: number) {
  const body: TodoUpdate = { done: true }
  try {
    await api.patch(`/api/todos/${id}`, body)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler.'
  }
}

async function remove(id: number) {
  try {
    await api.delete(`/api/todos/${id}`)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler.'
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b p-3">
      <h3 class="text-sm font-semibold">Todos</h3>
    </div>
    <div class="flex-1 space-y-2 overflow-y-auto p-3">
      <p v-if="loading" class="text-sm text-muted-foreground">Lädt…</p>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
      <p v-else-if="todos.length === 0" class="text-sm text-muted-foreground">
        Nichts offen.
      </p>
      <div
        v-for="t in todos"
        :key="t.id"
        class="flex items-start gap-2 rounded-md border p-2 text-sm"
      >
        <Button size="icon" variant="ghost" class="size-7" @click="markDone(t.id)">
          <Check class="size-3.5" />
        </Button>
        <p class="flex-1 break-words">{{ t.content }}</p>
        <Button size="icon" variant="ghost" class="size-7" @click="remove(t.id)">
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </div>
    <form class="flex gap-2 border-t p-3" @submit.prevent="add">
      <Input v-model="newContent" placeholder="Neues Todo…" />
      <Button type="submit" size="sm">Add</Button>
    </form>
  </div>
</template>
