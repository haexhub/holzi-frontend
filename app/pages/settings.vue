<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import ThemeToggle from '~/components/ThemeToggle.vue'
import { settingsNav } from '~/lib/settingsNav'

// Parent layout for /settings/* — owns the page chrome (header, back
// button, theme toggle, sidebar/top-nav). The child pages render the
// section content inside `<NuxtPage />`.
//
// Navigation is route-based (NuxtLink) so deep links + the browser
// back button work naturally. `active-class` styles the current entry.
//
// Layout:
//  - desktop (md+): sticky sidebar on the left (stays visible while
//    long content like the LLM section scrolls), content on the right
//  - mobile: horizontally scrollable top tabs, content below
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">Control Center</h1>
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

    <!-- Mobile: horizontal scroll tabs -->
    <nav
      class="-mx-6 overflow-x-auto border-b md:hidden"
      aria-label="Control Center (mobile)"
    >
      <div class="flex gap-1 px-6">
        <NuxtLink
          v-for="item in settingsNav"
          :key="item.to"
          :to="item.to"
          active-class="border-foreground text-foreground"
          class="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <component :is="item.icon" class="size-4" />
          {{ item.label }}
        </NuxtLink>
      </div>
    </nav>

    <div class="flex flex-1 gap-8">
      <!-- Desktop: sidebar (sticky so it stays in view on long sections) -->
      <nav
        class="sticky top-6 hidden h-fit w-52 shrink-0 flex-col gap-0.5 self-start md:flex"
        aria-label="Control Center (desktop)"
      >
        <NuxtLink
          v-for="item in settingsNav"
          :key="item.to"
          :to="item.to"
          active-class="bg-muted text-foreground"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <component :is="item.icon" class="size-4" />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <main class="min-w-0 flex-1">
        <NuxtPage />
      </main>
    </div>
  </div>
</template>
