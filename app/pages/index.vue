<script setup lang="ts">
import {
  AlertCircle,
  Bell,
  ListChecks,
  LogOut,
  NotebookPen,
  Settings,
  X,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import ChatComposer from '~/components/chat/ChatComposer.vue'
import ChatMessage from '~/components/chat/ChatMessage.vue'
import ConversationList from '~/components/chat/ConversationList.vue'
import EmptyChatState from '~/components/chat/EmptyChatState.vue'
import NotesPanel from '~/components/panels/NotesPanel.vue'
import RemindersPanel from '~/components/panels/RemindersPanel.vue'
import TodosPanel from '~/components/panels/TodosPanel.vue'
import ThemeToggle from '~/components/ThemeToggle.vue'
import { useApi } from '~/composables/useApi'
import { friendlyChatError, sendChatMessage } from '~/composables/useChatStream'
import { useLlmCredentials } from '~/composables/useLlmCredentials'
import { useAuthStore } from '~/stores/auth'
import type { Conversation, ConversationDetail, Message } from '~/types/api'

const auth = useAuthStore()
const api = useApi()
const llm = useLlmCredentials()
const router = useRouter()

const conversations = ref<Conversation[]>([])
const activeId = ref<number | null>(null)
const messages = ref<Message[]>([])
const streaming = ref(false)
const streamingText = ref('')
const error = ref<string | null>(null)
const activePanel = ref<'notes' | 'todos' | 'reminders'>('notes')
const messagesScroller = ref<HTMLElement | null>(null)
// `null` while the credentials list is still loading — EmptyChatState
// uses this to avoid flashing the "add credentials" CTA before we know.
const hasCredentials = ref<boolean | null>(null)
const searchQuery = ref('')

async function loadConversations() {
  try {
    const query: Record<string, unknown> = { channel: 'web' }
    if (searchQuery.value) {
      query.q = searchQuery.value
    }
    conversations.value = await api.get<Conversation[]>(
      '/api/conversations',
      query,
    )
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  }
}

function onSearch(q: string) {
  searchQuery.value = q
  loadConversations()
}

async function toggleBookmark(id: number) {
  try {
    const updated = await api.post<Conversation>(
      `/api/conversations/${id}/bookmark`,
    )
    // Patch the row in place so the sidebar order doesn't jump unless the
    // backend also moved updated_at (it doesn't when bookmarking).
    conversations.value = conversations.value.map((c) =>
      c.id === id ? { ...c, ...updated } : c,
    )
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Bookmark fehlgeschlagen.'
  }
}

async function renameConversation(id: number, title: string) {
  try {
    await api.patch<Conversation>(`/api/conversations/${id}`, { title })
    await loadConversations()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Umbenennen.'
  }
}

async function deleteConversation(id: number) {
  try {
    await api.delete<void>(`/api/conversations/${id}`)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (activeId.value === id) {
      newChat()
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Löschen.'
  }
}

async function loadCredentialState() {
  try {
    const creds = await llm.list()
    hasCredentials.value = creds.length > 0
  } catch {
    // Silent: if we can't determine credential state, fall back to the
    // generic greeting (treat-as-has-credentials) rather than leaving
    // the user with no empty-state guidance at all.
    hasCredentials.value = true
  }
}

async function selectConversation(id: number) {
  activeId.value = id
  try {
    const detail = await api.get<ConversationDetail>(`/api/conversations/${id}`)
    messages.value = detail.messages
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  }
  await nextTick()
  scrollToBottom()
}

function newChat() {
  activeId.value = null
  messages.value = []
}

async function send(text: string) {
  if (streaming.value) return
  // Optimistic: render the user message immediately.
  const optimisticUserId = -Date.now()
  messages.value = [
    ...messages.value,
    {
      id: optimisticUserId,
      role: 'user',
      content: text,
      ts: Math.floor(Date.now() / 1000),
    },
  ]
  await nextTick()
  scrollToBottom()

  streaming.value = true
  streamingText.value = ''
  error.value = null
  try {
    const result = await sendChatMessage(
      { message: text, conversation_id: activeId.value ?? undefined },
      {
        onSession: (id) => {
          activeId.value = id
        },
        onText: (chunk) => {
          streamingText.value += chunk
          nextTick(scrollToBottom)
        },
      },
    )
    // Reload the full server-side conversation to get canonical ids,
    // tool turns, and timestamps. Cheaper than diffing the optimistic state.
    await selectConversation(result.conversationId)
    await loadConversations()
  } catch (err: unknown) {
    error.value = friendlyChatError(err)
  } finally {
    streaming.value = false
    streamingText.value = ''
  }
}

function scrollToBottom() {
  const el = messagesScroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function logout() {
  auth.clear()
  router.replace('/login')
}

onMounted(() => {
  loadConversations()
  loadCredentialState()
})
</script>

<template>
  <div class="grid h-screen grid-cols-[260px_1fr_320px]">
    <!-- Left sidebar: conversations -->
    <aside class="border-r">
      <ConversationList
        :conversations="conversations"
        :active-id="activeId"
        @select="selectConversation"
        @new-chat="newChat"
        @toggle-bookmark="toggleBookmark"
        @rename="renameConversation"
        @delete="deleteConversation"
        @search="onSearch"
      />
    </aside>

    <!-- Center: chat -->
    <main class="flex h-screen flex-col">
      <header class="flex items-center justify-between border-b px-4 py-2">
        <h1 class="text-sm font-semibold">
          {{ activeId === null ? 'Neuer Chat' : `Conversation #${activeId}` }}
        </h1>
        <div class="flex items-center gap-1">
          <ThemeToggle />
          <NuxtLink to="/settings/llm">
            <Button size="sm" variant="ghost">
              <Settings class="mr-1 size-4" />
              Settings
            </Button>
          </NuxtLink>
          <Button size="sm" variant="ghost" @click="logout">
            <LogOut class="mr-1 size-4" />
            Logout
          </Button>
        </div>
      </header>

      <div
        ref="messagesScroller"
        class="flex-1 space-y-3 overflow-y-auto p-4"
      >
        <EmptyChatState
          v-if="messages.length === 0 && !streaming"
          :has-credentials="hasCredentials"
        />
        <ChatMessage
          v-for="m in messages"
          :key="m.id"
          :message="m"
        />
        <ChatMessage
          v-if="streaming && streamingText"
          :message="{ role: 'assistant', content: streamingText }"
        />
        <div v-if="streaming && !streamingText" class="flex justify-start">
          <div class="rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">
            <span class="inline-flex gap-1">
              <span class="size-1.5 animate-bounce rounded-full bg-current" />
              <span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
              <span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
            </span>
          </div>
        </div>
        <div
          v-if="error"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle class="mt-0.5 size-4 shrink-0" />
          <p class="flex-1">{{ error }}</p>
          <button
            type="button"
            class="rounded p-0.5 text-destructive/70 hover:text-destructive"
            aria-label="Fehler ausblenden"
            @click="error = null"
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <ChatComposer :disabled="streaming" @send="send" />
    </main>

    <!-- Right panel: notes/todos/reminders -->
    <aside class="flex h-screen flex-col border-l">
      <nav class="flex border-b">
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 border-r px-3 py-2 text-xs font-medium transition-colors"
          :class="activePanel === 'notes' ? 'bg-accent' : 'hover:bg-muted'"
          @click="activePanel = 'notes'"
        >
          <NotebookPen class="size-3.5" /> Notes
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 border-r px-3 py-2 text-xs font-medium transition-colors"
          :class="activePanel === 'todos' ? 'bg-accent' : 'hover:bg-muted'"
          @click="activePanel = 'todos'"
        >
          <ListChecks class="size-3.5" /> Todos
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 px-3 py-2 text-xs font-medium transition-colors"
          :class="activePanel === 'reminders' ? 'bg-accent' : 'hover:bg-muted'"
          @click="activePanel = 'reminders'"
        >
          <Bell class="size-3.5" /> Reminders
        </button>
      </nav>
      <Separator />
      <div class="flex-1 overflow-hidden">
        <NotesPanel v-if="activePanel === 'notes'" />
        <TodosPanel v-else-if="activePanel === 'todos'" />
        <RemindersPanel v-else-if="activePanel === 'reminders'" />
      </div>
    </aside>
  </div>
</template>
