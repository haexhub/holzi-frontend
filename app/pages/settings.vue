<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ThemeToggle from '~/components/ThemeToggle.vue'

// Parent layout for /settings/* — owns the page chrome (header, back
// button, theme toggle, tab nav). The child pages render LLM / Messenger
// content inside `<NuxtPage />`.
//
// Tabs are route-based (NuxtLink) rather than in-page state so deep
// links + the browser back button work naturally. `active-class` from
// NuxtLink handles the styling for the current tab.

const tabs = [
  { to: '/settings/llm', label: 'LLM' },
  { to: '/settings/messenger', label: 'Messenger' },
] as const
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">Einstellungen</h1>
        <p class="text-sm text-muted-foreground">
          Provider, Messenger und sonstige Konfiguration des Agents.
        </p>
      </div>
      <div class="flex items-center gap-1">
        <ThemeToggle />
        <NuxtLink to="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft class="mr-1 size-4" />
            Zurück
          </Button>
        </NuxtLink>
      </div>
    </header>

    <nav class="flex gap-1 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        active-class="border-foreground text-foreground"
        class="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
