import { useAuthStore } from '~/stores/auth'

/**
 * Subscribe to /api/chat's SSE stream.
 *
 * The hermes endpoint emits these event types over `text/event-stream`:
 *   - `session`   → { conversation_id: number }
 *   - `run`       → { run_id: string }     (handle for cancelChatRun)
 *   - `text`      → { content: string }    (assistant delta)
 *   - `cancelled` → {}                     (terminal — user clicked Stop)
 *   - `done`      → {}                     (terminal — turn finished cleanly)
 * Plus on failure:
 *   - `error`     → { code, status_code, message }
 *
 * Returns the conversation_id, run_id, assembled text, and a `cancelled`
 * flag. `cancelled` is terminal: any events after it on the wire are
 * ignored, so callers can rely on the result reflecting state at the
 * moment of cancellation.
 */
export interface ChatStreamResult {
  conversationId: number
  runId: string | null
  text: string
  cancelled: boolean
}

export interface ChatStreamCallbacks {
  onSession?: (conversationId: number) => void
  onRun?: (runId: string) => void
  onText?: (chunk: string) => void
  signal?: AbortSignal
}

/**
 * Codes emitted by `_classify_chat_error` in `src/hermes/routes/api.py`.
 * Kept loose (`string`) so an unknown future code falls through to a
 * generic message instead of breaking the build.
 */
export type ChatStreamErrorCode =
  | 'upstream_http_error'
  | 'upstream_timeout'
  | 'upstream_unreachable'
  | 'agent_error'
  | (string & {})

export class ChatStreamError extends Error {
  readonly code: ChatStreamErrorCode
  readonly statusCode: number | null

  constructor(message: string, opts: { code?: ChatStreamErrorCode; statusCode?: number | null } = {}) {
    super(message)
    this.name = 'ChatStreamError'
    this.code = opts.code ?? 'unknown'
    this.statusCode = opts.statusCode ?? null
  }
}

export async function sendChatMessage(
  payload: { message: string; conversation_id?: number },
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream('/api/chat', payload, callbacks)
}

/**
 * Regenerate the latest assistant response in a conversation.
 *
 * Hits `POST /api/conversations/{id}/retry`, which drops the trailing
 * assistant/tool turns and re-runs the agent. The response uses the exact
 * same SSE contract as /api/chat, so it streams through the same consumer
 * and returns the same shape — callers reuse their normal-send state.
 */
export async function retryLastResponse(
  conversationId: number,
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream(
    `/api/conversations/${encodeURIComponent(conversationId)}/retry`,
    null,
    callbacks,
  )
}

/**
 * Edit a previous user message and regenerate the conversation from it.
 *
 * Hits `POST /api/conversations/{id}/messages/{messageId}/edit-and-regenerate`,
 * which rewrites the user message in place, drops every later turn, and
 * re-runs the agent over the corrected context. The response uses the exact
 * same SSE contract as /api/chat, so it streams through the same consumer
 * and returns the same shape.
 */
export async function editAndRegenerate(
  conversationId: number,
  messageId: number,
  content: string,
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit-and-regenerate`,
    { content },
    callbacks,
  )
}

async function postChatStream(
  url: string,
  body: Record<string, unknown> | null,
  callbacks: ChatStreamCallbacks,
): Promise<ChatStreamResult> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new Error('not authenticated')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
    signal: callbacks.signal,
  })

  if (response.status === 401) {
    auth.clear()
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new ChatStreamError(
      `chat request failed: ${response.status} ${detail}`,
      { code: 'request_failed', statusCode: response.status },
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let conversationId: number | null = null
  let runId: string | null = null
  let assistantText = ''
  let cancelled = false
  let streamError: ChatStreamError | null = null

  outer: while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE blocks are separated by a blank line.
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const { event, data } = parseSseBlock(block)
      if (!event) continue
      switch (event) {
        case 'session': {
          conversationId = (data as { conversation_id?: number }).conversation_id ?? null
          if (conversationId !== null) {
            callbacks.onSession?.(conversationId)
          }
          break
        }
        case 'run': {
          runId = (data as { run_id?: string }).run_id ?? null
          if (runId !== null) {
            callbacks.onRun?.(runId)
          }
          break
        }
        case 'text': {
          const chunk = (data as { content?: string }).content ?? ''
          assistantText += chunk
          callbacks.onText?.(chunk)
          break
        }
        case 'cancelled':
          // Terminal: stop reading and let the caller render the turn
          // as aborted. Discard anything still in the buffer — the
          // backend contract is that `cancelled` is the last event.
          cancelled = true
          break outer
        case 'done':
          break
        case 'error': {
          const payload = data as {
            code?: ChatStreamErrorCode
            status_code?: number
            message?: string
          }
          streamError = new ChatStreamError(
            payload.message ?? 'unknown agent error',
            { code: payload.code, statusCode: payload.status_code ?? null },
          )
          break
        }
      }
    }
  }

  if (streamError) {
    throw streamError
  }
  if (conversationId === null) {
    throw new ChatStreamError('chat stream ended without a session event')
  }
  return { conversationId, runId, text: assistantText, cancelled }
}


/**
 * Best-effort cancel of an in-flight chat run.
 *
 * Resolves on 204 (cancel delivered) or 404 (run already finished, which
 * is a normal race when the user clicks Stop right as the stream ends).
 * Throws on other failures so the caller can surface a real problem.
 */
export async function cancelChatRun(runId: string): Promise<void> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  const response = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  })
  // 401 mid-stream means the token expired while the user was typing —
  // clear it so the next action redirects to /login, and surface the
  // same `unauthorized` code as sendChatMessage so friendlyChatError
  // shows the session-expired copy.
  if (response.status === 401) {
    auth.clear()
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  if (response.status === 204 || response.status === 404) {
    return
  }
  const detail = await response.text().catch(() => '')
  throw new ChatStreamError(
    `cancel failed: ${response.status} ${detail}`,
    { code: 'request_failed', statusCode: response.status },
  )
}

/**
 * Render a ChatStreamError as user-facing copy. Generic Errors fall
 * through to their own `.message`; unknown future codes fall back to
 * a neutral "Chat-Fehler" so the UI never shows a raw stack trace.
 */
export function friendlyChatError(err: unknown): string {
  if (!(err instanceof ChatStreamError)) {
    return err instanceof Error ? err.message : 'Chat-Fehler.'
  }
  switch (err.code) {
    case 'upstream_unreachable':
      return 'LLM-Provider nicht erreichbar. Prüfe deine Credentials in den Settings.'
    case 'upstream_timeout':
      return 'LLM-Provider hat zu lange gebraucht. Versuch es nochmal.'
    case 'upstream_http_error':
      return `LLM-Provider hat einen Fehler zurückgegeben${err.statusCode ? ` (${err.statusCode})` : ''}. Versuch es gleich nochmal.`
    case 'agent_error':
      return `Interner Fehler: ${err.message}`
    case 'unauthorized':
      return 'Session abgelaufen — bitte neu einloggen.'
    case 'request_failed':
      return `Chat-Request fehlgeschlagen${err.statusCode ? ` (${err.statusCode})` : ''}.`
    default:
      // Don't leak backend `err.message` for codes we haven't mapped —
      // they could carry raw upstream text. New codes should be added
      // to this switch deliberately.
      return 'Chat-Fehler.'
  }
}

function parseSseBlock(block: string): { event: string | null; data: unknown } {
  let event: string | null = null
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }
  if (!event || dataLines.length === 0) return { event, data: {} }
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return { event, data: {} }
  }
}
