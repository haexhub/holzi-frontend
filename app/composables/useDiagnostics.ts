import { ref } from 'vue'
import { useApi } from '~/composables/useApi'
import type { AgentRun, DiagnosticsResponse } from '~/types/api'

/**
 * Plan 20: thin wrapper around `/api/diagnostics` plus the
 * `/api/runs?status=error` slice that backs the "Recent failures"
 * panel. Both expose their own loading/error flags so the page can
 * keep the subsystem-check list visible while the failures list
 * (separately, potentially slower) reloads.
 */
export function useDiagnostics() {
  const api = useApi()

  const diagnostics = ref<DiagnosticsResponse | null>(null)
  const diagnosticsLoading = ref(false)
  const diagnosticsError = ref<string | null>(null)

  const failures = ref<AgentRun[]>([])
  const failuresLoading = ref(false)
  const failuresError = ref<string | null>(null)

  async function loadDiagnostics(): Promise<void> {
    diagnosticsLoading.value = true
    diagnosticsError.value = null
    try {
      diagnostics.value = await api.get<DiagnosticsResponse>('/api/diagnostics')
    } catch (err: unknown) {
      diagnosticsError.value =
        err instanceof Error ? err.message : 'Fehler beim Laden.'
    } finally {
      diagnosticsLoading.value = false
    }
  }

  async function loadFailures(limit = 20): Promise<void> {
    failuresLoading.value = true
    failuresError.value = null
    try {
      failures.value = await api.get<AgentRun[]>('/api/runs', {
        status: 'error',
        limit,
      })
    } catch (err: unknown) {
      failuresError.value =
        err instanceof Error ? err.message : 'Fehler beim Laden.'
    } finally {
      failuresLoading.value = false
    }
  }

  async function loadAll(): Promise<void> {
    await Promise.all([loadDiagnostics(), loadFailures()])
  }

  return {
    diagnostics,
    diagnosticsLoading,
    diagnosticsError,
    failures,
    failuresLoading,
    failuresError,
    loadDiagnostics,
    loadFailures,
    loadAll,
  }
}
