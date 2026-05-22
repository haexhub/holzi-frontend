<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApi } from '~/composables/useApi'
import type { Reminder, ReminderCreate } from '~/types/api'

const api = useApi()
const reminders = ref<Reminder[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const newMessage = ref('')
const newWhen = ref('')

async function load() {
  loading.value = true
  error.value = null
  try {
    reminders.value = await api.get<Reminder[]>('/api/reminders')
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loading.value = false
  }
}

async function add() {
  const message = newMessage.value.trim()
  const whenIso = newWhen.value
  if (!message || !whenIso) return
  // <input type="datetime-local"> yields "YYYY-MM-DDTHH:mm" in local time.
  const due = new Date(whenIso)
  if (Number.isNaN(due.getTime())) {
    error.value = 'Ungültiger Zeitpunkt.'
    return
  }
  const body: ReminderCreate = {
    message,
    due_at: Math.floor(due.getTime() / 1000),
    channel: 'signal',
  }
  try {
    await api.post('/api/reminders', body)
    newMessage.value = ''
    newWhen.value = ''
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Speichern.'
  }
}

async function remove(id: number) {
  try {
    await api.delete(`/api/reminders/${id}`)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler.'
  }
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b p-3">
      <h3 class="text-sm font-semibold">Reminders</h3>
    </div>
    <div class="flex-1 space-y-2 overflow-y-auto p-3">
      <p v-if="loading" class="text-sm text-muted-foreground">Lädt…</p>
      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
      <p v-else-if="reminders.length === 0" class="text-sm text-muted-foreground">
        Keine offenen Reminders.
      </p>
      <div
        v-for="r in reminders"
        :key="r.id"
        class="rounded-md border p-2 text-sm"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="break-words">{{ r.message }}</p>
            <p class="text-xs text-muted-foreground">
              {{ fmt(r.due_at) }} · {{ r.channel }}
            </p>
          </div>
          <Button size="icon" variant="ghost" class="size-7" @click="remove(r.id)">
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
    <form class="space-y-2 border-t p-3" @submit.prevent="add">
      <Input v-model="newMessage" placeholder="Nachricht" />
      <Input v-model="newWhen" type="datetime-local" />
      <Button type="submit" size="sm" class="w-full">Reminder anlegen</Button>
    </form>
  </div>
</template>
