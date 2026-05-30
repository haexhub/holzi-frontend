<script setup lang="ts">
import { BarChart3, RefreshCcw } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useInsights } from '~/composables/useInsights'
import { estimateTotalCostUsd } from '~/lib/pricing'
import type { InsightsPeriod } from '~/types/api'

// Plan 27: read-only daily usage + per-model split + status counts over
// `agent_runs`. No chart library — the bar chart is a row of Tailwind
// divs with percentage heights. Auto-refresh every 60s while the tab is
// visible so a long-running session doesn't go stale.

const { insights, loading, error, period, load, setPeriod } = useInsights()

const PERIOD_OPTIONS: { value: InsightsPeriod; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
]

const refreshTimer = ref<ReturnType<typeof setInterval> | null>(null)

function startAutoRefresh(): void {
  stopAutoRefresh()
  refreshTimer.value = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void load()
    }
  }, 60_000)
}

function stopAutoRefresh(): void {
  if (refreshTimer.value !== null) {
    clearInterval(refreshTimer.value)
    refreshTimer.value = null
  }
}

onMounted(() => {
  void load()
  startAutoRefresh()
})
onBeforeUnmount(stopAutoRefresh)

const totals = computed(() => insights.value?.totals ?? null)
const series = computed(() => insights.value?.series ?? [])
const byModel = computed(() => insights.value?.by_model ?? [])
const byStatus = computed(() => insights.value?.by_status ?? null)

const maxBarValue = computed(() => {
  let max = 0
  for (const b of series.value) {
    const total = b.input_tokens + b.output_tokens
    if (total > max) max = total
  }
  return max
})

const totalCostUsd = computed(() => estimateTotalCostUsd(byModel.value))

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `<$0.01`
}

function bucketHeightPct(input: number, output: number): number {
  if (maxBarValue.value === 0) return 0
  return ((input + output) / maxBarValue.value) * 100
}

function shortBucketLabel(bucket: string): string {
  // YYYY-MM-DD → MM-DD for the chart tick (the FE renders in UTC,
  // matching the backend's bucket boundary).
  return bucket.slice(5)
}

// Sortable per-model table. Default by run count desc (backend order),
// but let users flip to tokens / errors for a quick look.
type SortKey = 'runs' | 'input_tokens' | 'output_tokens' | 'errors'
const sortKey = ref<SortKey>('runs')

const sortedByModel = computed(() => {
  return [...byModel.value].sort((a, b) => b[sortKey.value] - a[sortKey.value])
})
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="insights-page">
    <!-- ── Header ──────────────────────────────────────────────── -->
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <BarChart3 class="size-5 text-muted-foreground" />
        <h2 class="text-base font-semibold">Insights</h2>
      </div>
      <div class="flex items-center gap-2">
        <div
          class="inline-flex rounded-md border bg-background p-0.5"
          data-testid="insights-period"
        >
          <button
            v-for="opt in PERIOD_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              period === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            "
            :aria-pressed="period === opt.value"
            :data-testid="`insights-period-${opt.value}`"
            @click="setPeriod(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          :disabled="loading"
          aria-label="Neu laden"
          data-testid="insights-refresh"
          @click="load"
        >
          <RefreshCcw class="mr-1 size-4" />
          Neu laden
        </Button>
      </div>
    </header>

    <p v-if="loading && !insights" class="text-xs text-muted-foreground">
      Lädt…
    </p>
    <p
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
      data-testid="insights-error"
    >
      {{ error }}
    </p>

    <!-- ── KPI tiles ───────────────────────────────────────────── -->
    <section
      v-if="totals"
      class="grid grid-cols-2 gap-3 sm:grid-cols-4"
      data-testid="insights-totals"
    >
      <div class="rounded-md border p-3" data-testid="insights-tile-runs">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground">
          Runs
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ totals.runs }}
        </p>
      </div>
      <div class="rounded-md border p-3" data-testid="insights-tile-tokens">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground">
          Tokens (in / out)
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ formatTokens(totals.input_tokens) }}
          <span class="text-base font-normal text-muted-foreground">
            / {{ formatTokens(totals.output_tokens) }}
          </span>
        </p>
      </div>
      <div class="rounded-md border p-3" data-testid="insights-tile-errors">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground">
          Errors
        </p>
        <p
          class="mt-1 text-2xl font-semibold tabular-nums"
          :class="totals.errors > 0 ? 'text-destructive' : ''"
        >
          {{ totals.errors }}
        </p>
      </div>
      <div class="rounded-md border p-3" data-testid="insights-tile-cost">
        <p class="text-[11px] uppercase tracking-wide text-muted-foreground">
          Kosten (geschätzt)
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ formatCost(totalCostUsd) }}
        </p>
      </div>
    </section>

    <!-- ── Bar chart ───────────────────────────────────────────── -->
    <section
      v-if="series.length > 0"
      class="rounded-md border"
      data-testid="insights-series"
    >
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">Tägliche Token-Nutzung</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          UTC-Tage, Bars summieren Input + Output.
        </p>
      </header>
      <div class="p-4">
        <div class="flex h-32 items-end gap-1" role="img" aria-label="Token-Nutzung pro Tag">
          <div
            v-for="bucket in series"
            :key="bucket.bucket"
            class="flex flex-1 flex-col items-center justify-end gap-1"
            :data-testid="`insights-bucket-${bucket.bucket}`"
            :title="`${bucket.bucket}: in ${bucket.input_tokens}, out ${bucket.output_tokens}, runs ${bucket.runs}`"
          >
            <div
              class="w-full rounded-t bg-primary/70 transition-all"
              :style="{ height: `${bucketHeightPct(bucket.input_tokens, bucket.output_tokens)}%` }"
            />
          </div>
        </div>
        <div class="mt-2 flex gap-1">
          <div
            v-for="bucket in series"
            :key="bucket.bucket"
            class="flex-1 text-center text-[10px] text-muted-foreground tabular-nums"
          >
            {{ shortBucketLabel(bucket.bucket) }}
          </div>
        </div>
      </div>
    </section>

    <!-- ── Per-model table ─────────────────────────────────────── -->
    <section
      v-if="byModel.length > 0"
      class="rounded-md border"
      data-testid="insights-by-model"
    >
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">Pro Modell</h3>
      </header>
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-muted/40 text-left text-xs text-muted-foreground">
            <th class="px-3 py-2 font-medium">Modell</th>
            <th
              class="cursor-pointer px-3 py-2 text-right font-medium tabular-nums"
              :class="sortKey === 'runs' ? 'text-foreground' : ''"
              data-testid="insights-by-model-sort-runs"
              @click="sortKey = 'runs'"
            >
              Runs
            </th>
            <th
              class="cursor-pointer px-3 py-2 text-right font-medium tabular-nums"
              :class="sortKey === 'input_tokens' ? 'text-foreground' : ''"
              data-testid="insights-by-model-sort-input"
              @click="sortKey = 'input_tokens'"
            >
              In
            </th>
            <th
              class="cursor-pointer px-3 py-2 text-right font-medium tabular-nums"
              :class="sortKey === 'output_tokens' ? 'text-foreground' : ''"
              data-testid="insights-by-model-sort-output"
              @click="sortKey = 'output_tokens'"
            >
              Out
            </th>
            <th
              class="cursor-pointer px-3 py-2 text-right font-medium tabular-nums"
              :class="sortKey === 'errors' ? 'text-foreground' : ''"
              data-testid="insights-by-model-sort-errors"
              @click="sortKey = 'errors'"
            >
              Errors
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sortedByModel"
            :key="row.model"
            class="border-t"
            :data-testid="`insights-model-${row.model}`"
          >
            <td class="px-3 py-2 font-mono text-xs">{{ row.model }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ row.runs }}</td>
            <td class="px-3 py-2 text-right tabular-nums">
              {{ formatTokens(row.input_tokens) }}
            </td>
            <td class="px-3 py-2 text-right tabular-nums">
              {{ formatTokens(row.output_tokens) }}
            </td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="row.errors > 0 ? 'text-destructive' : ''"
            >
              {{ row.errors }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ── Status counts ───────────────────────────────────────── -->
    <section
      v-if="byStatus"
      class="rounded-md border p-3"
      data-testid="insights-by-status"
    >
      <h3 class="text-sm font-semibold">Run-Status</h3>
      <ul class="mt-2 flex flex-wrap gap-3 text-xs">
        <li class="flex items-center gap-1.5" data-testid="insights-status-success">
          <span class="size-2 rounded-full bg-emerald-500" />
          <span class="text-muted-foreground">Success:</span>
          <span class="font-medium tabular-nums">{{ byStatus.success }}</span>
        </li>
        <li class="flex items-center gap-1.5" data-testid="insights-status-error">
          <span class="size-2 rounded-full bg-destructive" />
          <span class="text-muted-foreground">Error:</span>
          <span class="font-medium tabular-nums">{{ byStatus.error }}</span>
        </li>
        <li class="flex items-center gap-1.5" data-testid="insights-status-cancelled">
          <span class="size-2 rounded-full bg-amber-500" />
          <span class="text-muted-foreground">Cancelled:</span>
          <span class="font-medium tabular-nums">{{ byStatus.cancelled }}</span>
        </li>
        <li class="flex items-center gap-1.5" data-testid="insights-status-running">
          <span class="size-2 rounded-full bg-sky-500" />
          <span class="text-muted-foreground">Running:</span>
          <span class="font-medium tabular-nums">{{ byStatus.running }}</span>
        </li>
      </ul>
    </section>

    <p
      v-if="!loading && !error && totals && totals.runs === 0"
      class="text-xs text-muted-foreground"
      data-testid="insights-empty"
    >
      Noch keine Runs im gewählten Zeitraum.
    </p>
  </div>
</template>
