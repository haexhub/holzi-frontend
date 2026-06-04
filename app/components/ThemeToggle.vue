<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'

// The preference (`colorMode.value`) can be 'auto' | 'light' | 'dark';
// `state` resolves 'auto' against the OS preference, so the icon
// always reflects what's actually on screen.
const colorMode = useColorMode()
const isDark = computed(() => colorMode.state.value === 'dark')

function toggle() {
  colorMode.value = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <UiButton
    size="sm"
    variant="ghost"
    :aria-label="isDark ? 'Light-Mode' : 'Dark-Mode'"
    :aria-pressed="isDark"
    @click="toggle"
  >
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
  </UiButton>
</template>
