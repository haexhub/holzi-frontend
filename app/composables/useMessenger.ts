import { useApi } from '~/composables/useApi'
import { useAuthStore } from '~/stores/auth'
import type {
  MessengerAccountActivateResponse,
  MessengerAccountCreateResponse,
  MessengerAccountDeleteResponse,
  MessengerAccountListResponse,
  TelegramAccountCreate,
} from '~/types/api'

/**
 * Thin domain wrapper around `/api/messenger/*`. Mirrors the
 * `useLlmCredentials` shape but with one Signal-only quirk:
 * `/signal/link/start` returns image/png, not JSON — we fetch it as a
 * blob and hand back an object URL so the page can drop it straight
 * into `<img :src>`.
 */
export function useMessenger() {
  const api = useApi()
  const auth = useAuthStore()

  return {
    list: () =>
      api.get<MessengerAccountListResponse>('/api/messenger/accounts'),

    startSignalLink: async (): Promise<string> => {
      if (!auth.isAuthenticated) {
        throw new Error('not authenticated')
      }
      // useApi.post auto-decodes JSON which would garble the PNG. Use
      // raw $fetch with responseType: 'blob' so the bytes stay intact.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = $fetch as any
      const blob = (await f('/api/messenger/accounts/signal/link/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        responseType: 'blob',
      })) as Blob
      // Caller is responsible for `URL.revokeObjectURL` when the QR is
      // replaced or the page unmounts — leaking blob URLs blows up the
      // browser's blob storage after a while.
      return URL.createObjectURL(blob)
    },

    pollSignalLink: () =>
      api.post<MessengerAccountListResponse>(
        '/api/messenger/accounts/signal/link/poll',
      ),

    createTelegram: (body: TelegramAccountCreate) =>
      api.post<MessengerAccountCreateResponse>(
        '/api/messenger/accounts/telegram',
        body,
      ),

    activate: (id: number) =>
      api.patch<MessengerAccountActivateResponse>(
        `/api/messenger/accounts/${id}/activate`,
      ),

    deleteAccount: (id: number) =>
      api.delete<MessengerAccountDeleteResponse>(
        `/api/messenger/accounts/${id}`,
      ),
  }
}
