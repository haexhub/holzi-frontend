<script setup lang="ts">
import { useRoute } from 'vue-router'
import { settingsNav } from '~/lib/settingsNav'

const route = useRoute()
const item = computed(() => settingsNav.find((n) => n.to === route.path))
</script>

<template>
  <div v-if="item" class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <component :is="item.icon" class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">{{ item.label }}</h2>
    </div>
    <p v-if="item.upcoming" class="text-sm text-muted-foreground">
      {{ item.upcoming }}
    </p>
    <div class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      Diese Sektion ist noch nicht implementiert.
    </div>
  </div>
</template>
