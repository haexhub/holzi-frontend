import { useAuthStore } from '~/stores/auth'

/**
 * Subscribe to /api/chat's SSE stream.
 *
 * The hermes endpoint emits three event types over `text/event-stream`:
 *   - `session` → { conversation_id: number }
 *   - `text`    → { content: string }   (final assistant message)
 *   - `done`    → {}
 * Plus on failure:
 *   - `error`   → { message: string }
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
    throw new Error('unauthorized')
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(`chat request failed: ${response.status} ${detail}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let conversationId: number | null = null
  let assistantText = ''
  let errorMessage: string | null = null

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
        case 'error':
          errorMessage = (data as { message?: string }).message ?? 'unknown agent error'
          break
      }
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage)
  }
  if (conversationId === null) {
    throw new Error('chat stream ended without a session event')
  }
  return { conversationId, text: assistantText }
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
