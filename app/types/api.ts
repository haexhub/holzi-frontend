/**
 * Hand-rolled API shapes — kept thin until `openapi-typescript` is wired up.
 * Mirror the responses from `/api/*` in `hermes-server`. When the backend
 * changes, regenerate via `pnpm run gen:api`.
 */

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
