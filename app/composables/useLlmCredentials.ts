import { useApi } from '~/composables/useApi'
import type {
  LlmCredential,
  LlmCredentialCreate,
  OAuthStartResponse,
  OAuthStatusResponse,
} from '~/types/api'

/**
 * Thin domain wrapper around `/api/llm/credentials/*`. Centralises path
 * strings so the page and the Vitest tests stay aligned, and gives a
 * single place to swap in `pnpm run gen:api`-generated types when those
 * regenerate.
 *
 * The OAuth flow has four legs (start / code / status / cancel) that
 * the page wires together — see `app/pages/settings/llm.vue` for the
 * state machine.
 */
export function useLlmCredentials() {
  const api = useApi()

  return {
    list: () => api.get<LlmCredential[]>('/api/llm/credentials'),

    createApiKey: (body: LlmCredentialCreate) =>
      api.post<LlmCredential>('/api/llm/credentials', body),

    activate: (id: number) =>
      api.patch<LlmCredential>(`/api/llm/credentials/${id}/activate`),

    delete: (id: number) =>
      api.delete<void>(`/api/llm/credentials/${id}`),

    oauthStart: () =>
      api.post<OAuthStartResponse>('/api/llm/credentials/oauth/start'),

    oauthSubmitCode: (id: number, code: string) =>
      api.post<LlmCredential>(
        `/api/llm/credentials/oauth/${id}/code`,
        { code },
      ),

    oauthStatus: (id: number) =>
      api.get<OAuthStatusResponse>(
        `/api/llm/credentials/oauth/${id}/status`,
      ),

    oauthCancel: (id: number) =>
      api.post<void>(`/api/llm/credentials/oauth/${id}/cancel`),
  }
}
