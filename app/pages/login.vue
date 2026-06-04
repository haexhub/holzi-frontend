<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const token = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

definePageMeta({ layout: 'default' })

async function submit() {
  if (!token.value.trim()) {
    error.value = 'Token darf nicht leer sein.'
    return
  }
  submitting.value = true
  error.value = null
  try {
    // Probe the API once to validate the token before storing it.
    const res = await fetch('/api/ping', {
      headers: { Authorization: `Bearer ${token.value.trim()}` },
    })
    if (res.status === 401) {
      error.value = 'Token ungültig (401).'
      return
    }
    if (!res.ok) {
      error.value = `Server antwortete mit ${res.status}.`
      return
    }
    auth.setToken(token.value)
    await router.replace('/')
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Netzwerkfehler.'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (auth.isAuthenticated) {
    router.replace('/')
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <UiCard class="w-full max-w-md">
      <UiCardHeader>
        <UiCardTitle>Hermes</UiCardTitle>
        <UiCardDescription>
          Bearer-Token eingeben. Wird nur lokal im Browser gespeichert.
        </UiCardDescription>
      </UiCardHeader>
      <UiCardContent>
        <form class="space-y-4" @submit.prevent="submit">
          <div class="space-y-2">
            <UiLabel for="token">Token</UiLabel>
            <UiInput
              id="token"
              v-model="token"
              type="password"
              placeholder="hex-string"
              autocomplete="current-password"
              autofocus
            />
          </div>
          <p v-if="error" class="text-sm text-destructive">
            {{ error }}
          </p>
          <UiButton type="submit" :disabled="submitting" class="w-full">
            {{ submitting ? 'Prüfe…' : 'Einloggen' }}
          </UiButton>
        </form>
      </UiCardContent>
    </UiCard>
  </div>
</template>
