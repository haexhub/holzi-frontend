<script setup lang="ts">
import {
  AlertCircle,
  FolderTree,
  LogOut,
  Menu,
  NotebookPen,
  PanelRight,
  Settings,
  X,
} from 'lucide-vue-next'
import { Brain } from 'lucide-vue-next'
import AttachmentChip from '~/components/chat/AttachmentChip.vue'
import ChatComposer from '~/components/chat/ChatComposer.vue'
import ChatMessage from '~/components/chat/ChatMessage.vue'
import ToolCallCard from '~/components/chat/ToolCallCard.vue'
import ApprovalCard from '~/components/chat/ApprovalCard.vue'
import ReasoningCard from '~/components/chat/ReasoningCard.vue'
import SandboxCrashCard from '~/components/chat/SandboxCrashCard.vue'
import SubagentCard from '~/components/chat/SubagentCard.vue'
import ConversationList from '~/components/chat/ConversationList.vue'
import EmptyChatState from '~/components/chat/EmptyChatState.vue'
import NotesPanel from '~/components/panels/NotesPanel.vue'
import WorkspacePanel from '~/components/panels/WorkspacePanel.vue'
import { useMediaQuery } from '@vueuse/core'
import ThemeToggle from '~/components/ThemeToggle.vue'
import ResizableHandle from '~/components/ui/resizable/ResizableHandle.vue'
import ResizablePanel from '~/components/ui/resizable/ResizablePanel.vue'
import ResizablePanelGroup from '~/components/ui/resizable/ResizablePanelGroup.vue'
import { useApi } from '~/composables/useApi'
import { useChatQueue } from '~/composables/useChatQueue'
import { useToast } from '~/composables/useToast'
import {
  type ApprovalDecision,
  cancelChatRun,
  type ChatStreamCallbacks,
  type ChatStreamResult,
  editAndRegenerate,
  friendlyChatError,
  resolveApproval,
  retryLastResponse,
  sendChatMessage,
  type StreamState,
} from '~/composables/useChatStream'
import { useLlmCredentials } from '~/composables/useLlmCredentials'
import { useReasoningPreference } from '~/composables/useReasoningPreference'
import { useLastConversationStore } from '~/stores/lastConversation'
import { useAuthStore } from '~/stores/auth'
import type {
  Attachment,
  Conversation,
  ConversationDetail,
  Message,
  SandboxCrashedData,
} from '~/types/api'
import Button from '@/components/ui/button/Button.vue'
import Separator from '@/components/ui/separator/Separator.vue'

// Plan 26: the active conversation id is now driven by the URL. `/`
// passes null; `/chat/:id` parses and passes the numeric id (or null
// when the route param doesn't parse). The hub watches it and loads the
// conversation accordingly. The hub also navigates on selection / new
// chat so URL stays the source of truth.
const props = defineProps<{
  conversationId: number | null
}>()

const auth = useAuthStore()
const api = useApi()
const llm = useLlmCredentials()
const router = useRouter()
const toast = useToast()
const { showReasoningByDefault, setShowReasoningByDefault } = useReasoningPreference()

const conversations = ref<Conversation[]>([])
const activeId = ref<number | null>(props.conversationId)
const messages = ref<Message[]>([])
// Plan 26: true while a conversation's messages are being fetched. Used
// to suppress EmptyChatState on cold deep-link load — otherwise the
// "Sag Hermes Hallo." greeting flashes briefly before the real history
// appears. Pre-seeded `true` when the hub mounts with a non-null id so
// the very first paint already hides the empty state.
const loadingConversation = ref<boolean>(props.conversationId !== null)
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
// Tool cards for the turn in flight, keyed by call_id and flipped from
// running → success/error as results arrive. Cleared when the turn ends; the
// canonical reload then re-renders the persisted cards.
interface StreamingToolCall {
  call_id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'success' | 'error'
  result: string | null
  error: string | null
}
const streamingToolCalls = ref<StreamingToolCall[]>([])
// Approval cards for risky tool calls paused in the turn in flight, keyed by
// approval_id. `pending` until the user clicks, then `submitting` → resolved.
// Cleared when the turn ends; the reload shows the persisted tool outcome.
interface PendingApproval {
  approval_id: string
  call_id: string
  name: string
  arguments: Record<string, unknown>
  reason: string
  status: 'pending' | 'submitting' | 'allowed' | 'denied'
}
const pendingApprovals = ref<PendingApproval[]>([])
// Reasoning streamed for the turn in flight (concatenated deltas). Cleared
// when the turn ends; the reload then renders the persisted reasoning card.
const streamingReasoning = ref('')
// Subagent activity for the turn in flight, grouped by subagent_id. Holzi
// doesn't emit subagent events yet, but the wiring is here so they render the
// moment a future orchestrator does. Live-only (not persisted).
interface StreamingSubagent {
  subagent_id: string
  name: string
  prompt: string | null
  status: 'running' | 'success' | 'error'
  text: string
  result: string | null
  error: string | null
}
const streamingSubagents = ref<StreamingSubagent[]>([])
// Sandbox crashes surfaced by the agent's health watcher (Plan 11b-b). Keyed
// by sandbox_id so a re-emit (reconnect, retry) merges into the existing
// card. Conversation-scoped: cleared on conversation switch / new chat so a
// crash from chat A can't appear above chat B. Limitation: the watcher's
// event only reaches us while an SSE stream is open (see useChatStream);
// between-turn crashes aren't replayed here — Plan 20 (Diagnostics) owns the
// persistent crash log.
interface ActiveCrash {
  crash: SandboxCrashedData
  restarting: boolean
}
const sandboxCrashes = ref<ActiveCrash[]>([])
const currentRunId = ref<string | null>(null)
// Conversation whose most recent turn was user-cancelled. Scoped to a
// conversation so switching away and back doesn't leak the abgebrochen
// notice into an unrelated chat. Cleared by selectConversation() or on
// the next send into the same conversation.
const cancelledConversationId = ref<number | null>(null)
const error = ref<string | null>(null)
// Resizable sidebar panels. Widths persist via reka-ui's `auto-save-id`
// (localStorage). `*Collapsed` mirror the panel's collapsed state, driven by
// the panel's @collapse / @expand callbacks — used by the header toggle
// buttons to flip aria-expanded labels and decide whether a click expands
// or collapses.
const leftPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const rightPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
// Flipped by ResizableHandle's @dragging emit. Used to suppress the
// collapse/expand transition while the user is actively dragging — otherwise
// each pointer-move frame interpolates over 200ms and the handle feels laggy.
const isDragging = ref(false)
// Below the `lg` breakpoint the chat takes priority, so we auto-collapse
// both sidebars on the lg → md crossing. md → lg leaves them collapsed
// until the user re-opens via the header buttons.
const isLgScreen = useMediaQuery('(min-width: 1024px)')
const activePanel = ref<'notes' | 'workspace'>('notes')
const messagesScroller = ref<HTMLElement | null>(null)
// `null` while the credentials list is still loading — EmptyChatState
// uses this to avoid flashing the "add credentials" CTA before we know.
const hasCredentials = ref<boolean | null>(null)
const searchQuery = ref('')
// Monotonic counter so a slow earlier search response can't overwrite
// the result of a faster later one (debounced typing easily triggers
// overlapping requests).
let loadSeq = 0

// Plan 26: persist the last-active conversation id via the Pinia store
// (which wraps VueUse `useLocalStorage` — same pattern as `auth.ts`).
// Updated whenever a conversation becomes active (selection / fresh-chat
// first-send / route param load) and cleared on logout or when "Neuer
// Chat" routes back to `/`.
const lastConv = useLastConversationStore()
function rememberLastConversation(id: number | null) {
  lastConv.remember(id)
}

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
      // Drop the URL too — `newChat()` routes to `/`.
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

// Plan 26: row clicks now drive the URL — the route watcher loads.
function onSelect(id: number) {
  if (activeId.value === id) return
  navigateTo(`/chat/${id}`)
}

// Load + activate a conversation by id. Used by the route watcher; not
// by row clicks directly (those navigate first, see onSelect).
async function loadConversation(id: number) {
  if (activeId.value !== id) {
    // Switching to a different conversation — drop any cancel notice and
    // pending follow-ups that belonged to the previous active one, so they
    // can't leak into (or be sent against) the conversation we just opened.
    cancelledConversationId.value = null
    queue.clear()
    sandboxCrashes.value = []
  }
  activeId.value = id
  rememberLastConversation(id)
  loadingConversation.value = true
  try {
    const detail = await api.get<ConversationDetail>(`/api/conversations/${id}`)
    messages.value = detail.messages
  } catch (err: unknown) {
    // 404 fallback for direct deep-links lives in pages/chat/[id].vue.
    // Here we just surface the error if reload fails for other reasons.
    error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    loadingConversation.value = false
  }
  await nextTick()
  scrollToBottom()
}

// In-flow reload after a turn finishes — keeps activeId set, refetches
// messages with the canonical server state.
async function reloadActive(id: number) {
  activeId.value = id
  rememberLastConversation(id)
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
  sandboxCrashes.value = []
  loadingConversation.value = false
  rememberLastConversation(null)
  // Drop the id from the URL so a reload doesn't reopen the previous chat.
  if (router.currentRoute.value.path !== '/') {
    navigateTo('/')
  }
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
  streamingToolCalls.value = []
  pendingApprovals.value = []
  streamingReasoning.value = ''
  streamingSubagents.value = []
  currentRunId.value = null
  // Fresh activity supersedes any prior abort notice.
  cancelledConversationId.value = null
  error.value = null
  let outcome: 'done' | 'cancelled' | 'failed' = 'done'
  // Track whether this stream created a fresh conversation. If so, replace
  // the URL with `/chat/<id>` on first send so reload stays put.
  const wasFreshChat = activeId.value === null
  try {
    const result = await start({
      onSession: (id) => {
        activeId.value = id
        rememberLastConversation(id)
      },
      onRun: (id) => {
        currentRunId.value = id
      },
      onText: (chunk) => {
        streamingText.value += chunk
        nextTick(scrollToBottom)
      },
      onToolCall: (call) => {
        streamingToolCalls.value = [
          ...streamingToolCalls.value,
          {
            call_id: call.call_id,
            name: call.name,
            arguments: call.arguments ?? {},
            status: 'running',
            result: null,
            error: null,
          },
        ]
        nextTick(scrollToBottom)
      },
      onToolResult: (res) => {
        streamingToolCalls.value = streamingToolCalls.value.map((tc) =>
          tc.call_id === res.call_id
            ? { ...tc, status: res.status, result: res.result ?? null, error: res.error ?? null }
            : tc,
        )
        nextTick(scrollToBottom)
      },
      onApproval: (a) => {
        pendingApprovals.value = [
          ...pendingApprovals.value,
          {
            approval_id: a.approval_id,
            call_id: a.call_id,
            name: a.name,
            arguments: a.arguments ?? {},
            reason: a.reason,
            status: 'pending',
          },
        ]
        nextTick(scrollToBottom)
      },
      onReasoning: (chunk) => {
        streamingReasoning.value += chunk
        nextTick(scrollToBottom)
      },
      onSubagentStart: (s) => {
        streamingSubagents.value = [
          ...streamingSubagents.value,
          {
            subagent_id: s.subagent_id,
            name: s.name,
            prompt: s.prompt ?? null,
            status: 'running',
            text: '',
            result: null,
            error: null,
          },
        ]
        nextTick(scrollToBottom)
      },
      onSubagentText: (t) => {
        streamingSubagents.value = streamingSubagents.value.map((s) =>
          s.subagent_id === t.subagent_id
            ? { ...s, text: s.text + t.content }
            : s,
        )
        nextTick(scrollToBottom)
      },
      onSubagentDone: (d) => {
        streamingSubagents.value = streamingSubagents.value.map((s) =>
          s.subagent_id === d.subagent_id
            ? { ...s, status: d.status, result: d.result ?? null, error: d.error ?? null }
            : s,
        )
        nextTick(scrollToBottom)
      },
      onSandboxCrashed: (c) => {
        // Dedupe by sandbox_id: a re-emit (e.g. on reconnect) refreshes the
        // payload (state/exit_code may now be populated) but keeps the
        // restarting flag so an in-flight POST keeps its spinner.
        const idx = sandboxCrashes.value.findIndex(
          (x) => x.crash.sandbox_id === c.sandbox_id,
        )
        if (idx !== -1) {
          const existing = sandboxCrashes.value[idx]!
          sandboxCrashes.value = sandboxCrashes.value.map((entry, i) =>
            i === idx ? { crash: c, restarting: existing.restarting } : entry,
          )
          return
        }
        sandboxCrashes.value = [
          ...sandboxCrashes.value,
          { crash: c, restarting: false },
        ]
        nextTick(scrollToBottom)
      },
    })
    if (result.cancelled) {
      outcome = 'cancelled'
      // Backend did not persist an assistant turn — refresh the
      // conversation so the optimistic state is replaced by the
      // canonical rows and the abgebrochen notice renders. Capture the
      // id *before* reloadActive() so its "switched conversation"
      // branch doesn't clear the notice we're about to set.
      const cancelledId = result.conversationId
      await reloadActive(cancelledId)
      cancelledConversationId.value = cancelledId
      await loadConversations()
    }
    else {
      // Reload the full server-side conversation to get canonical ids,
      // tool turns, and timestamps. Cheaper than diffing optimistic state.
      await reloadActive(result.conversationId)
      await loadConversations()
    }
    // Plan 26: a fresh chat now has a stable URL — replace, don't push,
    // so the back button still returns to the previous route (e.g. `/`).
    if (wasFreshChat && activeId.value !== null) {
      const target = `/chat/${activeId.value}`
      if (router.currentRoute.value.path !== target) {
        navigateTo(target, { replace: true })
      }
    }
  } catch (err: unknown) {
    outcome = 'failed'
    error.value = friendlyChatError(err)
  } finally {
    streamingText.value = ''
    streamingToolCalls.value = []
    pendingApprovals.value = []
    streamingReasoning.value = ''
    streamingSubagents.value = []
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
  if (next) void send({ text: next.content, files: next.files })
}

// Upload each picked file to the conversation, returning the persisted
// attachment metadata in order. The backend validates type/size and ties
// each upload to the conversation (Plan 11).
async function uploadAttachments(
  conversationId: number,
  files: File[],
): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const file of files) {
    const fd = new FormData()
    fd.append('file', file)
    out.push(
      await api.post<Attachment>(
        `/api/conversations/${conversationId}/attachments`,
        fd,
      ),
    )
  }
  return out
}

function uploadErrorMessage(err: unknown): string {
  const e = err as { statusCode?: number; data?: { detail?: string } }
  if (e?.statusCode === 413) return 'Datei zu groß (max. 25 MB).'
  if (e?.statusCode === 415) return 'Dateityp wird nicht unterstützt.'
  return e?.data?.detail
    ? `Upload fehlgeschlagen: ${e.data.detail}`
    : 'Upload fehlgeschlagen.'
}

async function send(payload: { text: string; files: File[] }) {
  const text = payload.text
  const files = payload.files ?? []
  if (isStreaming.value) {
    // A turn is already in flight — hold this follow-up (and its files) in
    // the visible queue. flushQueue() sends it once the turn finishes.
    queue.enqueue(text, files)
    await nextTick()
    scrollToBottom()
    return
  }

  // Optimistic: render the user message (with chips built from the picked
  // files) immediately, before any upload, so a slow/large upload still
  // gives instant feedback. Reconciled by the post-stream reload.
  const optimisticUserId = -Date.now()
  messages.value = [
    ...messages.value,
    {
      id: optimisticUserId,
      role: 'user',
      content: text,
      ts: Math.floor(Date.now() / 1000),
      attachments: files.map((f, i) => ({
        id: optimisticUserId - i,
        conversation_id: activeId.value ?? 0,
        message_id: null,
        filename: f.name,
        content_type: f.type || 'application/octet-stream',
        size: f.size,
        created_at: 0,
      })),
    },
  ]
  await nextTick()
  scrollToBottom()

  // Attachments must reference an existing conversation, so create one up
  // front when this is the first message of a fresh chat, then upload.
  let conversationId = activeId.value
  let uploaded: Attachment[] = []
  if (files.length > 0) {
    let createdConversationId: number | null = null
    try {
      if (conversationId === null) {
        const convo = await api.post<Conversation>('/api/conversations', {
          message: text,
        })
        conversationId = convo.id
        createdConversationId = convo.id
        activeId.value = convo.id
        rememberLastConversation(convo.id)
        await loadConversations()
      }
      uploaded = await uploadAttachments(conversationId, files)
    } catch (err: unknown) {
      // Roll back the optimistic bubble and the empty conversation we may
      // have just created, so a failed upload leaves no stranded state.
      messages.value = messages.value.filter((m) => m.id !== optimisticUserId)
      if (createdConversationId !== null) {
        activeId.value = null
        rememberLastConversation(null)
        await api.delete<void>(`/api/conversations/${createdConversationId}`)
          .catch(() => {})
        await loadConversations()
      }
      error.value = uploadErrorMessage(err)
      return
    }
  }

  await runStream((callbacks) =>
    sendChatMessage(
      {
        message: text,
        conversation_id: conversationId ?? undefined,
        attachment_ids: uploaded.map((a) => a.id),
      },
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
    // Background failure — the stream is still on-screen, so a toast keeps
    // the inline error slot clear for in-flight stream errors.
    toast.error(friendlyChatError(err))
  }
}

function setApprovalStatus(
  approvalId: string,
  status: PendingApproval['status'],
) {
  pendingApprovals.value = pendingApprovals.value.map((a) =>
    a.approval_id === approvalId ? { ...a, status } : a,
  )
}

async function decideApproval(
  approvalId: string,
  decision: ApprovalDecision,
  reason?: string,
) {
  const current = pendingApprovals.value.find((a) => a.approval_id === approvalId)
  // Guard against double-submit: only a still-pending card can be decided.
  if (!current || current.status !== 'pending') return
  setApprovalStatus(approvalId, 'submitting')
  try {
    await resolveApproval(approvalId, decision, reason)
    // Any `allow_*` variant ran the tool; only `deny` paints the denied state.
    setApprovalStatus(approvalId, decision === 'deny' ? 'denied' : 'allowed')
  } catch (err: unknown) {
    // Let the user try again — the run is still waiting on this decision.
    error.value = friendlyChatError(err)
    setApprovalStatus(approvalId, 'pending')
  }
}

function dismissSandboxCrash(sandboxId: string) {
  sandboxCrashes.value = sandboxCrashes.value.filter(
    (c) => c.crash.sandbox_id !== sandboxId,
  )
}

async function restartSandbox(sandboxId: string) {
  const entry = sandboxCrashes.value.find((c) => c.crash.sandbox_id === sandboxId)
  if (!entry || entry.restarting) return
  const workspaceId = entry.crash.workspace_id
  sandboxCrashes.value = sandboxCrashes.value.map((c) =>
    c.crash.sandbox_id === sandboxId ? { ...c, restarting: true } : c,
  )
  try {
    await api.post(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sandbox/restart`,
    )
    sandboxCrashes.value = sandboxCrashes.value.filter(
      (c) => c.crash.sandbox_id !== sandboxId,
    )
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : ''
    error.value = detail
      ? `Sandbox-Neustart fehlgeschlagen: ${detail}`
      : 'Sandbox-Neustart fehlgeschlagen. Bitte erneut versuchen.'
    sandboxCrashes.value = sandboxCrashes.value.map((c) =>
      c.crash.sandbox_id === sandboxId ? { ...c, restarting: false } : c,
    )
  }
}

function scrollToBottom() {
  const el = messagesScroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function logout() {
  auth.clear()
  rememberLastConversation(null)
  router.replace('/login')
}

function toggleLeftSidebar() {
  const panel = leftPanelRef.value
  if (!panel) return
  if (leftCollapsed.value) panel.expand()
  else panel.collapse()
}

function toggleRightSidebar() {
  const panel = rightPanelRef.value
  if (!panel) return
  if (rightCollapsed.value) panel.expand()
  else panel.collapse()
}

watch(isLgScreen, (now, before) => {
  if (before && !now) {
    leftPanelRef.value?.collapse()
    rightPanelRef.value?.collapse()
  }
})

// Plan 26: the route param is the source of truth for the active id.
// Reacting to it covers back/forward, deep-links, and explicit
// navigateTo() calls from this same component (selection / new-chat).
watch(
  () => props.conversationId,
  (id) => {
    if (id === null) {
      // Route went back to `/` — clear local state without touching the URL
      // again (we may already be on `/`, or a parent did the navigate).
      if (activeId.value !== null) {
        activeId.value = null
        messages.value = []
        cancelledConversationId.value = null
        queue.clear()
        sandboxCrashes.value = []
        loadingConversation.value = false
      }
      return
    }
    if (id !== activeId.value) {
      void loadConversation(id)
    }
  },
)

onMounted(() => {
  loadConversations()
  loadCredentialState()
  // If we mounted with a conversation id from the route (deep-link or
  // reload of `/chat/:id`), load it now. The watcher above won't fire
  // for the initial value, so we kick it off explicitly.
  if (props.conversationId !== null) {
    void loadConversation(props.conversationId)
  }
  // Sub-lg initial load (e.g. mobile reload): the lg→sub-lg watcher above
  // never fires, so collapse explicitly. Runs after the splitter children
  // have mounted (and applied any auto-save state), so this overrides any
  // restored expanded layout for small viewports.
  if (!isLgScreen.value) {
    leftPanelRef.value?.collapse()
    rightPanelRef.value?.collapse()
  }
})
</script>

<template>
  <ResizablePanelGroup
    direction="horizontal"
    auto-save-id="holzi-chat-layout"
    class="h-screen"
  >
    <!-- Left sidebar: conversations. Collapsible + resizable via reka-ui
         Splitter; sizes persist in localStorage via `auto-save-id`. -->
    <ResizablePanel
      id="left-sidebar-panel"
      ref="leftPanelRef"
      :default-size="20"
      :min-size="14"
      :max-size="35"
      :collapsed-size="0"
      collapsible
      :class="isDragging ? undefined : 'transition-[flex] duration-200 ease-out'"
      @collapse="leftCollapsed = true"
      @expand="leftCollapsed = false"
    >
      <aside
        id="left-sidebar"
        class="h-screen overflow-hidden border-r bg-background"
        aria-label="Conversations"
      >
        <ConversationList
          :conversations="conversations"
          :active-id="activeId"
          @select="onSelect"
          @new-chat="newChat"
          @toggle-bookmark="toggleBookmark"
          @rename="renameConversation"
          @delete="deleteConversation"
          @search="onSearch"
        />
      </aside>
    </ResizablePanel>

    <ResizableHandle @dragging="isDragging = $event" />

    <!-- Center: chat -->
    <ResizablePanel
      id="main-panel"
      :default-size="56"
      :min-size="30"
      :class="isDragging ? undefined : 'transition-[flex] duration-200 ease-out'"
    >
      <main class="flex h-screen flex-col">
      <header class="flex items-center justify-between border-b px-4 py-2">
        <div class="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            :aria-label="leftCollapsed ? 'Conversations einblenden' : 'Conversations ausblenden'"
            :aria-expanded="!leftCollapsed"
            aria-controls="left-sidebar"
            @click="toggleLeftSidebar"
          >
            <Menu class="size-4" />
          </Button>
          <h1 class="text-sm font-semibold">
            {{ activeId === null ? 'Neuer Chat' : `Conversation #${activeId}` }}
          </h1>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-muted"
            :class="showReasoningByDefault ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground'"
            :aria-pressed="showReasoningByDefault"
            :title="showReasoningByDefault ? 'Gedankengang standardmäßig einklappen' : 'Gedankengang standardmäßig anzeigen'"
            @click="setShowReasoningByDefault(!showReasoningByDefault)"
          >
            <Brain class="size-4" />
          </button>
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
          <Button
            size="icon"
            variant="ghost"
            :aria-label="rightCollapsed ? 'Notes &amp; Workspace einblenden' : 'Notes &amp; Workspace ausblenden'"
            :aria-expanded="!rightCollapsed"
            aria-controls="right-sidebar"
            @click="toggleRightSidebar"
          >
            <PanelRight class="size-4" />
          </Button>
        </div>
      </header>

      <div
        ref="messagesScroller"
        class="flex-1 space-y-3 overflow-y-auto p-4"
      >
        <!-- Sandbox crash notifications (Plan 11b-b). Conversation-scoped,
             rendered at the top of the scroller so a fresh crash shows up
             above the next user/assistant message; scrolls with the chat. -->
        <div
          v-for="entry in sandboxCrashes"
          :key="`sandbox-crash-${entry.crash.sandbox_id}`"
          aria-live="polite"
          class="flex w-full flex-col items-start"
        >
          <SandboxCrashCard
            :crash="entry.crash"
            :restarting="entry.restarting"
            @restart="restartSandbox(entry.crash.sandbox_id)"
            @dismiss="dismissSandboxCrash(entry.crash.sandbox_id)"
          />
        </div>
        <EmptyChatState
          v-if="messages.length === 0 && !isStreaming && !loadingConversation"
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
        <!-- Live reasoning card for the turn in flight. Streamed thinking,
             shown before the tools/answer it produced. -->
        <div
          v-if="isStreaming && streamingReasoning"
          class="flex w-full flex-col items-start"
        >
          <ReasoningCard :content="streamingReasoning" streaming />
        </div>
        <!-- Live subagent activity for the turn in flight, grouped per agent. -->
        <div
          v-for="s in streamingSubagents"
          :key="`subagent-${s.subagent_id}`"
          class="flex w-full flex-col items-start"
        >
          <SubagentCard :subagent="s" />
        </div>
        <!-- Approval cards for risky tool calls paused in the turn in flight.
             A pending card blocks the run until the user decides. -->
        <div
          v-for="a in pendingApprovals"
          :key="`approval-${a.approval_id}`"
          class="flex w-full flex-col items-start"
        >
          <ApprovalCard
            :approval="a"
            :status="a.status"
            @decide="(payload) => decideApproval(a.approval_id, payload.decision, payload.reason)"
          />
        </div>
        <!-- Live tool cards for the turn in flight (shown before the final
             assistant text, mirroring the order they're emitted). -->
        <div
          v-for="tc in streamingToolCalls"
          :key="`live-${tc.call_id}`"
          class="flex w-full flex-col items-start"
        >
          <ToolCallCard :tool-call="tc" />
        </div>
        <ChatMessage
          v-if="isStreaming && streamingText"
          :message="{ role: 'assistant', content: streamingText }"
          plain
        />
        <div
          v-if="
            isStreaming
              && !streamingText
              && streamingToolCalls.length === 0
              && pendingApprovals.length === 0
              && !streamingReasoning
              && streamingSubagents.length === 0
          "
          class="flex justify-start"
        >
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
          <div
            v-if="q.files.length"
            class="mt-1 flex max-w-[80%] flex-wrap justify-end gap-1.5"
          >
            <AttachmentChip
              v-for="(f, i) in q.files"
              :key="`${q.id}-${i}`"
              :filename="f.name"
              :content-type="f.type || 'application/octet-stream'"
              :size="f.size"
            />
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
    </ResizablePanel>

    <ResizableHandle @dragging="isDragging = $event" />

    <!-- Right panel: notes + workspace. Collapsible + resizable. -->
    <ResizablePanel
      id="right-sidebar-panel"
      ref="rightPanelRef"
      :default-size="24"
      :min-size="18"
      :max-size="40"
      :collapsed-size="0"
      collapsible
      :class="isDragging ? undefined : 'transition-[flex] duration-200 ease-out'"
      @collapse="rightCollapsed = true"
      @expand="rightCollapsed = false"
    >
      <aside
        id="right-sidebar"
        class="flex h-screen flex-col overflow-hidden border-l bg-background"
        aria-label="Notes &amp; Workspace"
      >
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
            class="flex flex-1 items-center justify-center gap-1 px-3 py-2 text-xs font-medium transition-colors"
            :class="activePanel === 'workspace' ? 'bg-accent' : 'hover:bg-muted'"
            @click="activePanel = 'workspace'"
          >
            <FolderTree class="size-3.5" /> Workspace
          </button>
        </nav>
        <Separator />
        <div class="flex-1 overflow-hidden">
          <NotesPanel v-if="activePanel === 'notes'" />
          <WorkspacePanel
            v-else-if="activePanel === 'workspace'"
            :conversation-id="activeId"
          />
        </div>
      </aside>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
