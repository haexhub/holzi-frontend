import type {
  Persona,
  PersonaCreate,
  PersonaListResponse,
  PersonaUpdate,
} from '~/types/api'

/**
 * Thin REST wrapper around `/api/personas`. Backed by the Plan 29-A
 * personas + channel_prompts tables; the page combines this with
 * `useChannels` to render `/settings/preferences`.
 */
export function usePersonas() {
  const api = useApi()

  return {
    list: () => api.get<PersonaListResponse>('/api/personas'),

    create: (body: PersonaCreate) =>
      api.post<Persona>('/api/personas', body),

    update: (id: number, body: PersonaUpdate) =>
      api.put<Persona>(`/api/personas/${id}`, body),

    delete: (id: number) =>
      api.delete<void>(`/api/personas/${id}`),
  }
}
