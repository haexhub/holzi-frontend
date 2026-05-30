<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { resolveConfirm, useConfirmQueue } from '@/composables/useConfirm'
import { resolvePrompt, usePromptQueue } from '@/composables/usePromptDialog'

const confirmQueue = useConfirmQueue()
const promptQueue = usePromptQueue()

const currentConfirm = computed(() => confirmQueue.value[0] ?? null)
const currentPrompt = computed(() => promptQueue.value[0] ?? null)

const confirmOpen = computed(() => currentConfirm.value !== null)
const promptOpen = computed(() => currentPrompt.value !== null)

// reka emits update:open=false on ESC / pointer-outside / close-button.
// Treat any auto-close while a request is still in the queue as cancel.
function onConfirmOpenChange(next: boolean) {
  if (!next && currentConfirm.value) {
    resolveConfirm(currentConfirm.value.id, false)
  }
}
function onPromptOpenChange(next: boolean) {
  if (!next && currentPrompt.value) {
    resolvePrompt(currentPrompt.value.id, null)
  }
}

function onConfirm() {
  if (currentConfirm.value) resolveConfirm(currentConfirm.value.id, true)
}
function onCancelConfirm() {
  if (currentConfirm.value) resolveConfirm(currentConfirm.value.id, false)
}

const promptInput = ref('')
const promptInputEl = ref<HTMLInputElement | null>(null)

watch(currentPrompt, async (req) => {
  if (req) {
    promptInput.value = req.defaultValue ?? ''
    await nextTick()
    promptInputEl.value?.focus()
    promptInputEl.value?.select()
  }
})

function submitPrompt() {
  if (currentPrompt.value) resolvePrompt(currentPrompt.value.id, promptInput.value)
}
function cancelPrompt() {
  if (currentPrompt.value) resolvePrompt(currentPrompt.value.id, null)
}
</script>

<template>
  <AlertDialog :open="confirmOpen" @update:open="onConfirmOpenChange">
    <AlertDialogContent v-if="currentConfirm" data-testid="confirm-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ currentConfirm.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="currentConfirm.description">
          {{ currentConfirm.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button
          type="button"
          variant="outline"
          data-testid="confirm-cancel"
          @click="onCancelConfirm"
        >
          {{ currentConfirm.cancelLabel ?? 'Abbrechen' }}
        </Button>
        <Button
          type="button"
          :variant="currentConfirm.destructive ? 'destructive' : 'default'"
          data-testid="confirm-action"
          @click="onConfirm"
        >
          {{ currentConfirm.confirmLabel ?? (currentConfirm.destructive ? 'Löschen' : 'Bestätigen') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <Dialog :open="promptOpen" @update:open="onPromptOpenChange">
    <DialogContent v-if="currentPrompt" data-testid="prompt-dialog">
      <DialogHeader>
        <DialogTitle>{{ currentPrompt.title }}</DialogTitle>
        <DialogDescription v-if="currentPrompt.description">
          {{ currentPrompt.description }}
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-3" @submit.prevent="submitPrompt">
        <input
          ref="promptInputEl"
          v-model="promptInput"
          type="text"
          :placeholder="currentPrompt.placeholder"
          data-testid="prompt-input"
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="prompt-cancel"
            @click="cancelPrompt"
          >
            {{ currentPrompt.cancelLabel ?? 'Abbrechen' }}
          </Button>
          <Button type="submit" data-testid="prompt-confirm">
            {{ currentPrompt.confirmLabel ?? 'OK' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
