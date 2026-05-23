<script setup lang="ts">
import { LogOut, NotebookPen, Bell, ListChecks, Settings } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import ChatComposer from '~/components/chat/ChatComposer.vue'
import ChatMessage from '~/components/chat/ChatMessage.vue'
import ConversationList from '~/components/chat/ConversationList.vue'
import NotesPanel from '~/components/panels/NotesPanel.vue'
import RemindersPanel from '~/components/panels/RemindersPanel.vue'
import TodosPanel from '~/components/panels/TodosPanel.vue'
import { useApi } from '~/composables/useApi'
import { sendChatMessage } from '~/composables/useChatStream'
import { useAuthStore } from '~/stores/auth'
import type { Conversation, ConversationDetail, Message } from '~/types/api'

const auth = useAuthStore()
const api = useApi()
const router = useRouter()

const conversations = ref<Conversation[]>([])
const activeId = ref<number | null>(null)
const messages = ref<Message[]>([])
const streaming = ref(false)
const streamingText = ref('')
const error = ref<string | null>(null)
const activePanel = ref<'notes' | 'todos' | 'reminders'>('notes')
const messagesScroller = ref<HTMLElement | null>(null)

async function loadConversations() {
  try {
    conversations.value = await api.get<Conversation[]>('/api/conversations', {
      channel: 'web',
    })
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
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
    error.value = err instanceof Error ? err.message : 'Chat-Fehler.'
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

onMounted(loadConversations)
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
      />
    </aside>

    <!-- Center: chat -->
    <main class="flex h-screen flex-col">
      <header class="flex items-center justify-between border-b px-4 py-2">
        <h1 class="text-sm font-semibold">
          {{ activeId === null ? 'Neuer Chat' : `Conversation #${activeId}` }}
        </h1>
        <div class="flex items-center gap-1">
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
        <p
          v-if="messages.length === 0 && !streaming"
          class="py-12 text-center text-sm text-muted-foreground"
        >
          Sag Hermes Hallo.
        </p>
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
        <p v-if="error" class="text-center text-sm text-destructive">
          {{ error }}
        </p>
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
