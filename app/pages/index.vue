<script setup lang="ts">
// Plan 26: `/` is now just a redirect-or-empty-hub shell. On mount we
// try to restore the last conversation id from localStorage and verify
// it still exists; if so we replace `/` with `/chat/<id>` so reloads
// land on the same chat. Otherwise we render the empty hub (null id).
// The hub component handles the rest — selection, send, etc. all flow
// through `navigateTo(/chat/:id)` so the URL stays the source of truth.
import ChatHub from '~/components/ChatHub.vue'
import { useApi } from '~/composables/useApi'

const api = useApi()

// We intentionally never *render* ChatHub during a pending redirect: if
// we mounted the hub immediately and then navigated away on the next
// tick, its onMounted would fire a stray /api/conversations fetch.
// `ready` flips true once we've decided whether to redirect or stay.
const ready = ref(false)

onMounted(async () => {
  let lastId: number | null = null
  try {
    const raw = localStorage.getItem('holzi.lastConversationId')
    if (raw) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) lastId = parsed
    }
  }
  catch {
    // Storage disabled — fall through to the empty hub.
  }
  if (lastId === null) {
    ready.value = true
    return
  }
  try {
    await api.get(`/api/conversations/${lastId}`)
    // Still reachable — hand off to the deep-link route. `replace` so
    // the back button still returns to wherever the user came from.
    await navigateTo(`/chat/${lastId}`, { replace: true })
  }
  catch {
    // 404 / 401 / network — drop the stale pointer and render the empty hub.
    try { localStorage.removeItem('holzi.lastConversationId') } catch { /* */ }
    ready.value = true
  }
})
</script>

<template>
  <ChatHub v-if="ready" :conversation-id="null" />
</template>
