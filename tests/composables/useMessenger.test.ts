import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessenger } from '~/composables/useMessenger'
import { useAuthStore } from '~/stores/auth'

function stubFetch(impl: (path: string, opts: Record<string, unknown>) => unknown) {
  const fn = vi.fn(impl)
  vi.stubGlobal('$fetch', fn)
  return fn
}

describe('useMessenger', () => {
  beforeEach(() => {
    useAuthStore().setToken('test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GETs the list endpoint', async () => {
    const spy = stubFetch(() => ({ accounts: [] }))
    await useMessenger().list()
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('POSTs the signal link-poll endpoint', async () => {
    const spy = stubFetch(() => ({ accounts: [] }))
    await useMessenger().pollSignalLink()
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts/signal/link/poll',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('POSTs a telegram create with the bot_token in the body', async () => {
    const spy = stubFetch(() => ({
      account: {
        id: 1,
        provider: 'telegram',
        is_active: false,
        bot_username: 'holzi_bot',
      },
    }))
    const result = await useMessenger().createTelegram({
      bot_token: '12345:abc',
    })
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts/telegram',
      expect.objectContaining({
        method: 'POST',
        body: { bot_token: '12345:abc' },
      }),
    )
    expect(result.account.bot_username).toBe('holzi_bot')
  })

  it('POSTs a telegram create with allowed_chat_ids when provided', async () => {
    const spy = stubFetch(() => ({
      account: {
        id: 2,
        provider: 'telegram',
        is_active: false,
        bot_username: 'holzi_bot',
        allowed_chat_ids: '[42]',
      },
    }))
    await useMessenger().createTelegram({
      bot_token: '12345:abc',
      allowed_chat_ids: [42, 99],
    })
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts/telegram',
      expect.objectContaining({
        method: 'POST',
        body: { bot_token: '12345:abc', allowed_chat_ids: [42, 99] },
      }),
    )
  })

  it('PATCHes activate with no body', async () => {
    const spy = stubFetch(() => ({ account: { id: 1, is_active: true } }))
    await useMessenger().activate(1)
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts/1/activate',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('DELETEs by id', async () => {
    const spy = stubFetch(() => ({ deleted: true }))
    await useMessenger().deleteAccount(7)
    expect(spy).toHaveBeenCalledWith(
      '/api/messenger/accounts/7',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
