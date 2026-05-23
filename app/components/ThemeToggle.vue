<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'

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
  <Button
    size="sm"
    variant="ghost"
    :aria-label="isDark ? 'Light-Mode' : 'Dark-Mode'"
    @click="toggle"
  >
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
  </Button>
</template>
