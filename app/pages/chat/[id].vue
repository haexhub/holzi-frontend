<script setup lang="ts">
// Plan 26: deep-link route. Parses the id from the URL, validates the
// conversation exists (404 → toast + back to /), and hands the numeric
// id to <ChatHub>. The hub handles all chat state — this page is just
// the URL adapter. `useHead({ title })` updates the browser tab so
// multi-tab workflows don't all show "Neuer Chat".
import { useApi } from '~/composables/useApi'
import { useLastConversationStore } from '~/stores/lastConversation'
import { useToast } from '~/composables/useToast'

const route = useRoute()
const api = useApi()
const toast = useToast()
const lastConv = useLastConversationStore()

// Route param is always a string. Bookmarks and copy-paste can land
// here with garbage; reject anything that isn't a positive integer so
// the API gets a clean id (or we redirect away before mounting).
const conversationId = computed<number | null>(() => {
  const raw = route.params.id
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string') return null
  const n = Number(s)
  return Number.isInteger(n) && n > 0 ? n : null
})

const valid = ref<boolean | null>(null)

useHead({
  title: () =>
    valid.value && conversationId.value !== null
      ? `Chat ${conversationId.value} · Holzi`
      : 'Holzi',
})

async function validate(id: number | null) {
  if (id === null) {
    toast.error('Konversation nicht gefunden.')
    await navigateTo('/', { replace: true })
    return
  }
  try {
    await api.get(`/api/conversations/${id}`)
    valid.value = true
  }
  catch (err: unknown) {
    // 401 is handled by the global auth middleware (redirects to /login).
    // For anything else (404, 5xx, network) bounce back to `/` with a
    // toast — the URL was bookmarked but the chat is gone.
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status
    if (status === 401) return
    valid.value = false
    toast.error('Konversation nicht gefunden.')
    // Drop the last-active pointer too — if it was pointing here we
    // don't want `/` to bounce straight back.
    lastConv.clear()
    await navigateTo('/', { replace: true })
  }
}

// Re-validate when the param changes — covers browser back/forward
// between two different /chat/:id URLs.
watch(conversationId, (id) => { void validate(id) })

onMounted(() => { void validate(conversationId.value) })
</script>

<template>
  <ChatHub v-if="valid && conversationId !== null" :conversation-id="conversationId" />
</template>
