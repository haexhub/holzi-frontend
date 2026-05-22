/**
 * Public type surface used across the app.
 *
 * Request-body types (`NoteCreate`, `TodoCreate`, …) are aliased from the
 * auto-generated `api-generated.ts` (regenerate with `pnpm run gen:api`).
 *
 * Response-body types (`Conversation`, `Note`, …) are still hand-rolled —
 * hermes's FastAPI endpoints return `dict[str, Any]` rather than typed
 * Pydantic response models, so the OpenAPI schema has no named shapes for
 * them. Backend follow-up TODO: add `response_model=` to each endpoint;
 * then these can also move into `api-generated.ts`.
 */
import type { components } from './api-generated'

// --- Request bodies (from generated schema) -----------------------------
export type NoteCreate = components['schemas']['NoteCreate']
export type NoteUpdate = components['schemas']['NoteUpdate']
export type TodoCreate = components['schemas']['TodoCreate']
export type TodoUpdate = components['schemas']['TodoUpdate']
export type ReminderCreate = components['schemas']['ReminderCreate']
export type ValidationError = components['schemas']['HTTPValidationError']

// --- Response shapes (hand-rolled, see TODO above) -----------------------
export interface Conversation {
  id: number
  channel: string
  title: string | null
  started_at: number
  updated_at: number
  message_count?: number
}

export interface Message {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  ts: number
}

export interface ConversationDetail {
  conversation: Conversation
  messages: Message[]
}

export interface Note {
  id: number
  key: string
  content: string
  tags: string | null
  updated_at: number
}

export interface Todo {
  id: number
  content: string
  tags: string | null
  done_at: number | null
  created_at: number
}

export interface Reminder {
  id: number
  due_at: number
  message: string
  channel: string
  fired_at: number | null
  created_at: number
}
