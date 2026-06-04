import type {
  PersonaSkillListResponse,
  Skill,
  SkillCreate,
  SkillListResponse,
  SkillUpdate,
  PersonaSkillSetItem,
} from '~/types/api'

/**
 * Plan 33: CRUD over `/api/skills` plus persona-skill activation under
 * `/api/personas/{id}/skills`.
 *
 * `data` holds the list of all skills (refreshed after every mutation
 * so the UI never has to reconcile state). `listForPersona` returns
 * the result inline because the persona-skill view is rendered per
 * card on the preferences page — each card owns its own state.
 */
export function useSkills() {
  const api = useApi()

  const data = ref<SkillListResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get<SkillListResponse>('/api/skills')
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Fehler beim Laden.'
    } finally {
      loading.value = false
    }
  }

  async function create(body: SkillCreate): Promise<Skill> {
    const row = await api.post<Skill>('/api/skills', body)
    await list()
    return row
  }

  async function update(id: number, body: SkillUpdate): Promise<Skill> {
    const row = await api.put<Skill>(`/api/skills/${id}`, body)
    await list()
    return row
  }

  async function remove(id: number): Promise<void> {
    await api.delete<void>(`/api/skills/${id}`)
    await list()
  }

  async function listForPersona(
    personaId: number,
  ): Promise<PersonaSkillListResponse> {
    return api.get<PersonaSkillListResponse>(
      `/api/personas/${personaId}/skills`,
    )
  }

  async function setForPersona(
    personaId: number,
    items: PersonaSkillSetItem[],
  ): Promise<PersonaSkillListResponse> {
    return api.put<PersonaSkillListResponse>(
      `/api/personas/${personaId}/skills`,
      { items },
    )
  }

  return {
    data,
    loading,
    error,
    list,
    create,
    update,
    remove,
    listForPersona,
    setForPersona,
  }
}
