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
import { useChatQueue } from '~/composables/useChatQueue'
import {
  cancelChatRun,
  type ChatStreamCallbacks,
  type ChatStreamResult,
  editAndRegenerate,
  friendlyChatError,
  retryLastResponse,
  sendChatMessage,
  type StreamState,
} from '~/composables/useChatStream'
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
// Turn lifecycle. `streaming` is the only state that gates sending — every
// other state leaves the composer free, so a follow-up typed during a turn
// gets queued rather than dropped.
const streamState = ref<StreamState>('idle')
const isStreaming = computed(() => streamState.value === 'streaming')
// Follow-ups submitted while a turn streams. Rendered as pending user
// bubbles and flushed one-by-one after each turn finishes cleanly.
const queue = useChatQueue()
// Queued follow-ups that won't auto-send: the turn ended in a non-`done`
// state (drop or user cancel), so they're stranded until the user either
// sends them manually or switches conversation. Drives the retry affordance.
const queueStalled = computed(
  () =>
    !queue.isEmpty.value
    && (streamState.value === 'failed' || streamState.value === 'cancelled'),
)
const streamingText = ref('')
const currentRunId = ref<string | null>(null)
// Conversation whose most recent turn was user-cancelled. Scoped to a
// conversation so switching away and back doesn't leak the abgebrochen
// notice into an unrelated chat. Cleared by selectConversation() or on
// the next send into the same conversation.
const cancelledConversationId = ref<number | null>(null)
const error = ref<string | null>(null)
const activePanel = ref<'notes' | 'todos' | 'reminders'>('notes')
const messagesScroller = ref<HTMLElement | null>(null)
// `null` while the credentials list is still loading — EmptyChatState
// uses this to avoid flashing the "add credentials" CTA before we know.
const hasCredentials = ref<boolean | null>(null)
const searchQuery = ref('')
// Monotonic counter so a slow earlier search response can't overwrite
// the result of a faster later one (debounced typing easily triggers
// overlapping requests).
let loadSeq = 0

async function loadConversations() {
  const seq = ++loadSeq
  try {
    const query: Record<string, unknown> = { channel: 'web' }
    if (searchQuery.value) {
      query.q = searchQuery.value
    }
    const result = await api.get<Conversation[]>('/api/conversations', query)
    if (seq === loadSeq) {
      conversations.value = result
    }
  } catch (err: unknown) {
    if (seq === loadSeq) {
      error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
    }
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
  if (activeId.value !== id) {
    // Switching to a different conversation — drop any cancel notice and
    // pending follow-ups that belonged to the previous active one, so they
    // can't leak into (or be sent against) the conversation we just opened.
    // The in-stream reload calls this with the *same* id, so a mid-flush
    // queue survives.
    cancelledConversationId.value = null
    queue.clear()
  }
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
  cancelledConversationId.value = null
  queue.clear()
}

// id of the latest assistant message — the only turn that shows a Retry
// control (null when the conversation has no assistant reply yet).
const lastAssistantId = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m && m.role === 'assistant') return m.id
  }
  return null
})

// Shared streaming flow for both a fresh send and a retry: the SSE
// contract is identical, so only the request differs.
async function runStream(
  start: (callbacks: ChatStreamCallbacks) => Promise<ChatStreamResult>,
) {
  streamState.value = 'streaming'
  streamingText.value = ''
  currentRunId.value = null
  // Fresh activity supersedes any prior abort notice.
  cancelledConversationId.value = null
  error.value = null
  let outcome: 'done' | 'cancelled' | 'failed' = 'done'
  try {
    const result = await start({
      onSession: (id) => {
        activeId.value = id
      },
      onRun: (id) => {
        currentRunId.value = id
      },
      onText: (chunk) => {
        streamingText.value += chunk
        nextTick(scrollToBottom)
      },
    })
    if (result.cancelled) {
      outcome = 'cancelled'
      // Backend did not persist an assistant turn — refresh the
      // conversation so the optimistic state is replaced by the
      // canonical rows and the abgebrochen notice renders. Capture the
      // id *before* selectConversation() so its "switched conversation"
      // branch doesn't clear the notice we're about to set.
      const cancelledId = result.conversationId
      await selectConversation(cancelledId)
      cancelledConversationId.value = cancelledId
      await loadConversations()
    }
    else {
      // Reload the full server-side conversation to get canonical ids,
      // tool turns, and timestamps. Cheaper than diffing optimistic state.
      await selectConversation(result.conversationId)
      await loadConversations()
    }
  } catch (err: unknown) {
    outcome = 'failed'
    error.value = friendlyChatError(err)
  } finally {
    streamingText.value = ''
    currentRunId.value = null
    streamState.value =
      outcome === 'cancelled' ? 'cancelled' : outcome === 'failed' ? 'failed' : 'idle'
  }
  // Only a clean finish auto-advances the queue. After a cancel or a
  // dropped stream the queued messages stay put and visible (the user
  // gets an explicit retry path) so we never silently fire them.
  if (outcome === 'done') {
    flushQueue()
  }
}

// Send the next queued follow-up, if any. Runs one at a time: each send
// re-enters runStream, whose clean-finish path calls flushQueue again.
function flushQueue() {
  if (isStreaming.value) return
  const next = queue.dequeue()
  if (next) void send(next.content)
}

async function send(text: string) {
  if (isStreaming.value) {
    // A turn is already in flight — hold this follow-up in the visible
    // queue. flushQueue() sends it once the current turn finishes cleanly.
    queue.enqueue(text)
    await nextTick()
    scrollToBottom()
    return
  }
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

  await runStream((callbacks) =>
    sendChatMessage(
      { message: text, conversation_id: activeId.value ?? undefined },
      callbacks,
    ),
  )
}

async function retryLast() {
  if (isStreaming.value || activeId.value === null) return
  const conversationId = activeId.value
  // Optimistically drop the trailing assistant/tool tail so the UI shows
  // regeneration in place, mirroring what the backend does before re-running.
  const lastUserIdx = messages.value.map((m) => m.role).lastIndexOf('user')
  if (lastUserIdx >= 0) {
    messages.value = messages.value.slice(0, lastUserIdx + 1)
  }
  await nextTick()
  scrollToBottom()

  await runStream((callbacks) => retryLastResponse(conversationId, callbacks))
}

async function editMessage(messageId: number, content: string) {
  if (isStreaming.value || activeId.value === null) return
  const conversationId = activeId.value
  // Optimistically rewrite the edited turn and drop everything after it,
  // mirroring what the backend does before re-running.
  const idx = messages.value.findIndex((m) => m.id === messageId)
  const target = messages.value[idx]
  if (target) {
    messages.value = [...messages.value.slice(0, idx), { ...target, content }]
  }
  await nextTick()
  scrollToBottom()

  await runStream((callbacks) =>
    editAndRegenerate(conversationId, messageId, content, callbacks),
  )
}

async function stopStreaming() {
  const runId = currentRunId.value
  if (!runId) return
  try {
    await cancelChatRun(runId)
  } catch (err: unknown) {
    error.value = friendlyChatError(err)
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
          v-if="messages.length === 0 && !isStreaming"
          :has-credentials="hasCredentials"
        />
        <ChatMessage
          v-for="m in messages"
          :key="m.id"
          :message="m"
          :can-retry="!isStreaming && m.id === lastAssistantId"
          :retry-disabled="isStreaming"
          :can-edit="!isStreaming && m.role === 'user' && m.id > 0"
          :edit-disabled="isStreaming"
          @retry="retryLast"
          @edit="(content) => editMessage(m.id, content)"
        />
        <ChatMessage
          v-if="isStreaming && streamingText"
          :message="{ role: 'assistant', content: streamingText }"
        />
        <div v-if="isStreaming && !streamingText" class="flex justify-start">
          <div class="rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">
            <span class="inline-flex gap-1">
              <span class="size-1.5 animate-bounce rounded-full bg-current" />
              <span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
              <span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
            </span>
          </div>
        </div>
        <!-- Follow-ups the user queued while a turn was streaming. Shown as
             dimmed user bubbles so it's obvious they're pending, not sent. -->
        <div
          v-for="q in queue.items.value"
          :key="`queued-${q.id}`"
          class="flex w-full flex-col items-end"
        >
          <div
            class="max-w-[80%] rounded-2xl border border-dashed border-primary/40 bg-primary/10 px-4 py-2 text-sm whitespace-pre-wrap break-words text-foreground"
          >
            {{ q.content }}
          </div>
          <span class="mt-1 text-xs italic text-muted-foreground">
            {{ isStreaming ? 'In Warteschlange…' : 'Wartet — nicht gesendet' }}
          </span>
        </div>
        <!-- The turn ended without a clean finish (drop or cancel) while
             follow-ups were queued: keep them and give an obvious way to
             send them anyway, rather than auto-firing or stranding them. -->
        <div
          v-if="queueStalled"
          class="flex justify-start"
        >
          <Button size="sm" variant="outline" @click="flushQueue">
            Warteschlange jetzt senden
          </Button>
        </div>
        <div
          v-if="
            cancelledConversationId !== null
              && cancelledConversationId === activeId
              && !isStreaming
          "
          class="flex justify-start text-xs italic text-muted-foreground"
        >
          Antwort abgebrochen.
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

      <ChatComposer
        :streaming="isStreaming"
        :can-stop="currentRunId !== null"
        @send="send"
        @stop="stopStreaming"
      />
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
