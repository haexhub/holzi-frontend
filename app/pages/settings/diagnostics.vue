<script setup lang="ts">
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
} from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useDiagnostics } from '~/composables/useDiagnostics'
import type { AgentRun, DiagnosticsStatus } from '~/types/api'

// Plan 20: read-only status snapshot for the Control Center.
// Two sections — a flat subsystem-check list (one row per check returned
// by `/api/diagnostics`) and a "Recent failures" panel backed by
// `GET /api/runs?status=error`. The page is intentionally flatter than
// /settings/memory + /settings/tasks because nothing here is editable.

const {
  diagnostics,
  diagnosticsLoading,
  diagnosticsError,
  failures,
  failuresLoading,
  failuresError,
  loadAll,
} = useDiagnostics()

const expandedRunIds = ref<Set<string>>(new Set())

function toggleRun(id: string) {
  const next = new Set(expandedRunIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedRunIds.value = next
}

const overall = computed<DiagnosticsStatus | null>(() => {
  return diagnostics.value?.overall ?? null
})

function statusLabel(status: DiagnosticsStatus): string {
  return { ok: 'OK', warning: 'Warnung', error: 'Fehler' }[status]
}

function statusBadgeClass(status: DiagnosticsStatus): string {
  return {
    ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    error: 'bg-destructive/10 text-destructive',
  }[status]
}

function formatTimestamp(epoch: number | null): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

function describeDuration(run: AgentRun): string {
  if (!run.finished_at) return 'läuft …'
  const ms = (run.finished_at - run.started_at) * 1000
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

onMounted(loadAll)
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="diagnostics-page">
    <!-- ── Header: title + overall badge + refresh ─────────────── -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Activity class="size-5 text-muted-foreground" />
        <h2 class="text-base font-semibold">Diagnostics</h2>
        <span
          v-if="overall"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="statusBadgeClass(overall)"
          data-testid="diagnostics-overall"
        >
          {{ statusLabel(overall) }}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        :disabled="diagnosticsLoading || failuresLoading"
        aria-label="Neu laden"
        data-testid="diagnostics-refresh"
        @click="loadAll"
      >
        <RefreshCcw class="mr-1 size-4" />
        Neu laden
      </Button>
    </header>

    <!-- ── Subsystem checks ─────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="diagnostics-checks">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">Subsysteme</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Was der Agent zum Starten und für Chat / Messenger / Tools braucht.
        </p>
      </header>

      <p v-if="diagnosticsLoading" class="p-3 text-xs text-muted-foreground">
        Lädt…
      </p>
      <p
        v-else-if="diagnosticsError"
        class="p-3 text-xs text-destructive"
        data-testid="diagnostics-checks-error"
      >
        {{ diagnosticsError }}
      </p>
      <ul
        v-else-if="diagnostics"
        class="divide-y"
      >
        <li
          v-for="check in diagnostics.checks"
          :key="check.id"
          class="flex items-start gap-3 p-3"
          :data-testid="`diagnostics-check-${check.id}`"
        >
          <span class="mt-0.5 shrink-0">
            <CheckCircle2
              v-if="check.status === 'ok'"
              class="size-5 text-emerald-500"
              aria-hidden="true"
            />
            <AlertTriangle
              v-else-if="check.status === 'warning'"
              class="size-5 text-amber-500"
              aria-hidden="true"
            />
            <AlertCircle
              v-else
              class="size-5 text-destructive"
              aria-hidden="true"
            />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">{{ check.label }}</p>
              <span
                class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :class="statusBadgeClass(check.status)"
              >
                {{ statusLabel(check.status) }}
              </span>
            </div>
            <p class="mt-0.5 break-words text-xs text-muted-foreground">
              {{ check.message }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Recent failures ──────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="diagnostics-failures">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">Letzte Fehlläufe</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Agent-Runs mit Status <code>error</code> aus
          <code>/api/runs</code>. Zeile aufklappen für Trace.
        </p>
      </header>

      <p v-if="failuresLoading" class="p-3 text-xs text-muted-foreground">
        Lädt…
      </p>
      <p
        v-else-if="failuresError"
        class="p-3 text-xs text-destructive"
        data-testid="diagnostics-failures-error"
      >
        {{ failuresError }}
      </p>
      <p
        v-else-if="failures.length === 0"
        class="p-3 text-xs text-muted-foreground"
        data-testid="diagnostics-failures-empty"
      >
        Keine Fehlläufe registriert. 🎉
      </p>
      <ul v-else class="divide-y">
        <li
          v-for="run in failures"
          :key="run.id"
          :data-testid="`diagnostics-failure-${run.id}`"
        >
          <button
            type="button"
            class="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40"
            :aria-expanded="expandedRunIds.has(run.id)"
            @click="toggleRun(run.id)"
          >
            <ChevronDown
              v-if="expandedRunIds.has(run.id)"
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <ChevronRight
              v-else
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p class="text-sm font-medium">
                  {{ run.error_code ?? 'error' }}
                </p>
                <span class="text-xs text-muted-foreground">
                  · {{ run.channel }} · {{ run.model }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">
                {{ formatTimestamp(run.started_at) }} ·
                {{ describeDuration(run) }} ·
                Conv. #{{ run.conversation_id }}
              </p>
              <p
                v-if="run.error_message"
                class="mt-1 break-words text-xs"
              >
                {{ run.error_message }}
              </p>
            </div>
          </button>
          <pre
            v-if="expandedRunIds.has(run.id) && run.error_trace"
            class="mx-3 mb-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug"
            >{{ run.error_trace }}</pre>
          <p
            v-else-if="expandedRunIds.has(run.id)"
            class="mx-3 mb-3 text-xs text-muted-foreground"
          >
            Kein Traceback gespeichert.
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
