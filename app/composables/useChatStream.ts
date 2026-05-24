import { useAuthStore } from '~/stores/auth'

/**
 * Subscribe to /api/chat's SSE stream.
 *
 * The hermes endpoint emits three event types over `text/event-stream`:
 *   - `session` → { conversation_id: number }
 *   - `text`    → { content: string }   (final assistant message)
 *   - `done`    → {}
 * Plus on failure:
 *   - `error`   → { code, status_code, message }
 *
 * Returns the conversation_id from the `session` event and the assembled
 * assistant text once `done` arrives. Throws on `error` or non-2xx.
 */
export interface ChatStreamResult {
  conversationId: number
  text: string
}

export interface ChatStreamCallbacks {
  onSession?: (conversationId: number) => void
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
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new Error('not authenticated')
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(payload),
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
  let assistantText = ''
  let streamError: ChatStreamError | null = null

  while (true) {
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
        case 'text': {
          const chunk = (data as { content?: string }).content ?? ''
          assistantText += chunk
          callbacks.onText?.(chunk)
          break
        }
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
  return { conversationId, text: assistantText }
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
      return err.message || 'Chat-Fehler.'
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
