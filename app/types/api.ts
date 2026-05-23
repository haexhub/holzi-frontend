/**
 * Public type surface used across the app — every shape now comes from the
 * auto-generated `api-generated.ts`. Regenerate with `pnpm run gen:api` after
 * the backend's `/openapi.json` changes.
 */
import type { components } from './api-generated'

// --- Request bodies -----------------------------------------------------
export type NoteCreate = components['schemas']['NoteCreate']
export type NoteUpdate = components['schemas']['NoteUpdate']
export type TodoCreate = components['schemas']['TodoCreate']
export type TodoUpdate = components['schemas']['TodoUpdate']
export type ReminderCreate = components['schemas']['ReminderCreate']
export type ValidationError = components['schemas']['HTTPValidationError']

// --- Response bodies ----------------------------------------------------
export type Conversation = components['schemas']['ConversationSummaryResponse']
export type Message = components['schemas']['MessageResponse']
export type ConversationDetail = components['schemas']['ConversationDetailResponse']
export type Note = components['schemas']['NoteResponse']
export type Todo = components['schemas']['TodoResponse']
export type Reminder = components['schemas']['ReminderResponse']

// --- LLM credentials ----------------------------------------------------
// Declared manually until `pnpm run gen:api` is re-run against a Hermes
// build that ships the OAuth + CRUD endpoints (Phase 3+4 of the
// llm-credentials feature). Keep these shapes in sync with
// `src/hermes/routes/llm.py` until the regeneration happens.
export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'custom'

export interface LlmCredential {
  id: number
  provider: string
  mode: 'api_key' | 'oauth_claude' | string
  display_name: string
  base_url: string | null
  model: string | null
  is_active: boolean
  oauth_status: 'pending' | 'authorized' | 'expired' | null
  oauth_authorized_at: number | null
  created_at: number
  updated_at: number
}

export interface LlmModelChoice {
  id: string
  label: string
}

export interface LlmModelListResponse {
  models: LlmModelChoice[]
}

export interface LlmCredentialCreate {
  provider: LlmProvider
  display_name: string
  base_url?: string | null
  api_key: string
}

export interface OAuthStartResponse {
  id: number
  url: string
}

export interface OAuthStatusResponse {
  id: number
  status: 'pending' | 'authorized' | 'expired' | string
}
