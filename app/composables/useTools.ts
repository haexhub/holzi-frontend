import { useApi } from '~/composables/useApi'
import type { ToolsResponse } from '~/types/api'

/**
 * Plan 31: read-only inventory of the agent's tool catalog. Backs the
 * `/settings/skills` page; Plan 29-E will reuse this for the persona
 * tool-allowlist multi-select.
 */
export function useTools() {
  const api = useApi()

  const data = ref<ToolsResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get<ToolsResponse>('/api/tools')
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, list }
}
