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
