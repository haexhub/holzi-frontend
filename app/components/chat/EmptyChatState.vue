<script setup lang="ts">
import { ArrowRight, KeyRound, MessageCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

// `null` = credentials list still loading. We don't want to flash the
// "Start by adding credentials" CTA before the request resolves, so
// render nothing in that case.
defineProps<{
  hasCredentials: boolean | null
}>()
</script>

<template>
  <div
    v-if="hasCredentials !== null"
    class="flex flex-col items-center gap-4 py-16 text-center"
  >
    <template v-if="hasCredentials === false">
      <div class="rounded-full bg-muted p-3 text-muted-foreground">
        <KeyRound class="size-6" />
      </div>
      <div class="space-y-1">
        <h2 class="text-base font-semibold">Willkommen bei Hermes</h2>
        <p class="max-w-sm text-sm text-muted-foreground">
          Bevor du chatten kannst, brauchst du LLM-Credentials. Füge einen
          API-Key hinzu oder verbinde deinen Claude-Account per OAuth.
        </p>
      </div>
      <!-- Use as-child so the link is the interactive root — otherwise
           we end up with <a><button>, which is invalid HTML and breaks
           keyboard/screen-reader semantics. -->
      <Button as-child size="sm">
        <NuxtLink to="/settings/llm">
          Credentials einrichten
          <ArrowRight class="ml-1 size-4" />
        </NuxtLink>
      </Button>
    </template>

    <template v-else>
      <div class="rounded-full bg-muted p-3 text-muted-foreground">
        <MessageCircle class="size-6" />
      </div>
      <p class="text-sm text-muted-foreground">
        Sag Hermes Hallo.
      </p>
    </template>
  </div>
</template>
