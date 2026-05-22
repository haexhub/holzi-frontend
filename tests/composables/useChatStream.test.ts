import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendChatMessage } from '~/composables/useChatStream'
import { useAuthStore } from '~/stores/auth'

function sseBody(events: { event: string; data: unknown }[]): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('')
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

describe('sendChatMessage', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when no auth token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('not authenticated')
  })

  it('sends the Bearer header on the request', async () => {
    const spy = mockFetch(
      new Response(sseBody([{ event: 'session', data: { conversation_id: 1 } }, { event: 'done', data: {} }])),
    )
    await sendChatMessage({ message: 'hi' })
    expect(spy).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
    const callBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(callBody).toEqual({ message: 'hi' })
  })

  it('fires onSession with the conversation_id from the session event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 42 } },
        { event: 'text', data: { content: 'hi' } },
        { event: 'done', data: {} },
      ])),
    )
    const seenSessions: number[] = []
    const result = await sendChatMessage(
      { message: 'hi' },
      { onSession: (id) => seenSessions.push(id) },
    )
    expect(seenSessions).toEqual([42])
    expect(result.conversationId).toBe(42)
  })

  it('concatenates multiple text events and fires onText per chunk', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 7 } },
        { event: 'text', data: { content: 'Hello' } },
        { event: 'text', data: { content: ' ' } },
        { event: 'text', data: { content: 'world' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    const result = await sendChatMessage(
      { message: 'go' },
      { onText: (c) => chunks.push(c) },
    )
    expect(chunks).toEqual(['Hello', ' ', 'world'])
    expect(result.text).toBe('Hello world')
  })

  it('throws when the stream contains an error event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'error', data: { message: 'agent exploded' } },
      ])),
    )
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('agent exploded')
  })

  it('throws when the stream ends without a session event', async () => {
    mockFetch(new Response(sseBody([{ event: 'done', data: {} }])))
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow(/without a session event/)
  })

  it('clears the auth token on 401 and throws', async () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(true)
    mockFetch(new Response('', { status: 401 }))
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('unauthorized')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('parses SSE blocks split across multiple chunks', async () => {
    // Build a ReadableStream that delivers the SSE bytes in awkward fragments
    // to mimic real network behaviour (block boundaries mid-line).
    const enc = new TextEncoder()
    const full =
      'event: session\ndata: {"conversation_id":3}\n\nevent: text\nd' +
      'ata: {"content":"hel"}\n\nevent: text\ndata: {"content":"lo"}' +
      '\n\nevent: done\ndata: {}\n\n'
    const stream = new ReadableStream({
      start(controller) {
        const piece = 40
        for (let i = 0; i < full.length; i += piece) {
          controller.enqueue(enc.encode(full.slice(i, i + piece)))
        }
        controller.close()
      },
    })
    mockFetch(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    const result = await sendChatMessage({ message: 'hi' })
    expect(result.conversationId).toBe(3)
    expect(result.text).toBe('hello')
  })

  it('passes conversation_id in the request body when provided', async () => {
    const spy = mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 99 } },
        { event: 'done', data: {} },
      ])),
    )
    await sendChatMessage({ message: 'hi', conversation_id: 99 })
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.conversation_id).toBe(99)
  })
})
