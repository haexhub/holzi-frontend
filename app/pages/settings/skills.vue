<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCcw,
  ShieldAlert,
  Wrench,
} from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useMcpHealth } from '~/composables/useMcpHealth'
import { useTools } from '~/composables/useTools'
import { useToast } from '~/composables/useToast'
import type { ToolInfo } from '~/types/api'

// Plan 31: read-only inventory of what the agent can do.
//   1. MCP-Surface card — the streamable-HTTP mount that lets external
//      clients (Cline, HaexChat) reuse this agent's tools. Refresh
//      button re-polls `/api/mcp/health`. Configure-button is disabled
//      until Plan 32 ships the CRUD page.
//   2. Tool catalog — flat alphabetical list with `source` pill,
//      approval badge when relevant, JSON-schema toggle for parameters,
//      and a disabled per-tool Configure button as the Plan 32/33
//      sprungpunkt. No grouping (13-ish tools today; `source` becomes
//      the natural axis once Plan 32 brings MCP-sourced tools).

const toolsApi = useTools()
const mcpApi = useMcpHealth()
const toast = useToast()

const expandedToolNames = ref<Set<string>>(new Set())

// Tick every second so "vor X s" stays live without re-polling the
// backend — `lastCheckedAt` is captured client-side and the relative
// label is derived from it.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Two endpoints, two independent loaders — one failing doesn't hide
  // the other section.
  void toolsApi.list()
  void mcpApi.check()
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (nowTimer !== null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

function toggleTool(name: string) {
  const next = new Set(expandedToolNames.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedToolNames.value = next
}

function formatRelative(epochMs: number | null, nowMs: number): string {
  if (!epochMs) return 'noch nie geprüft'
  const deltaSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000))
  if (deltaSec < 60) return `vor ${deltaSec} s`
  const min = Math.floor(deltaSec / 60)
  if (min < 60) return `vor ${min} min`
  const hr = Math.floor(min / 60)
  return `vor ${hr} h`
}

function prettySchema(schema: ToolInfo['parameters_schema']): string {
  return JSON.stringify(schema, null, 2)
}

function hasParameters(tool: ToolInfo): boolean {
  const props = (tool.parameters_schema?.properties ?? null) as
    | Record<string, unknown>
    | null
  return !!props && Object.keys(props).length > 0
}

const SOURCE_PILL_CLASS =
  'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'

function sourceLabel(source: string): string {
  if (source === 'builtin') return 'built-in'
  // Plan 32: `mcp:<server-name>` — show the short form so the pill stays
  // readable while still naming the source server.
  if (source.startsWith('mcp:')) return source
  return source
}

async function copyMcpUrl() {
  if (!mcpApi.data.value) return
  try {
    await navigator.clipboard.writeText(mcpApi.data.value.url)
    toast.success('MCP-URL kopiert.')
  } catch {
    toast.error('Kopieren fehlgeschlagen.')
  }
}
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="skills-page">
    <!-- ── Header ──────────────────────────────────────────────── -->
    <header class="flex items-center gap-2">
      <Wrench class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">Skills &amp; Tools</h2>
    </header>

    <!-- ── MCP-Surface card ────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="mcp-card">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b p-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold">MCP-Server</h3>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Externe Clients wie Cline oder HaexChat können die Tools dieses
            Agents über MCP ansprechen.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          :disabled="mcpApi.loading.value"
          aria-label="MCP-Status neu laden"
          data-testid="mcp-refresh"
          @click="mcpApi.check"
        >
          <RefreshCcw class="mr-1 size-4" />
          Neu laden
        </Button>
      </header>

      <div class="space-y-3 p-3">
        <p
          v-if="mcpApi.loading.value && !mcpApi.data.value"
          class="text-xs text-muted-foreground"
          data-testid="mcp-loading"
        >
          Lädt…
        </p>
        <p
          v-else-if="mcpApi.error.value"
          class="text-xs text-destructive"
          data-testid="mcp-error"
        >
          Status unbekannt — {{ mcpApi.error.value }}
        </p>
        <template v-else-if="mcpApi.data.value">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span
              v-if="mcpApi.data.value.status === 'ok'"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
              data-testid="mcp-status"
            >
              <CheckCircle2 class="size-3.5" aria-hidden="true" />
              aktiv
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
              data-testid="mcp-status"
            >
              <AlertCircle class="size-3.5" aria-hidden="true" />
              inaktiv
            </span>
            <span
              class="text-xs text-muted-foreground"
              data-testid="mcp-tool-count"
            >
              {{ mcpApi.data.value.tool_count }} Tools exponiert
            </span>
            <span
              class="text-xs text-muted-foreground"
              data-testid="mcp-last-checked"
            >
              {{ formatRelative(mcpApi.lastCheckedAt.value, now) }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <code
              class="rounded bg-muted px-1.5 py-0.5 font-mono"
              data-testid="mcp-url"
            >{{ mcpApi.data.value.url }}</code>
            <Button
              size="sm"
              variant="ghost"
              aria-label="MCP-URL kopieren"
              data-testid="mcp-copy-url"
              @click="copyMcpUrl"
            >
              <Copy class="mr-1 size-3.5" />
              Kopieren
            </Button>
          </div>

          <p
            v-if="mcpApi.data.value.message"
            class="text-xs text-muted-foreground"
            data-testid="mcp-message"
          >
            {{ mcpApi.data.value.message }}
          </p>

          <p class="text-xs text-muted-foreground">
            Endpoint-URL <code class="font-mono">{host}/mcp</code> als
            Streamable-HTTP-MCP-Server konfigurieren. Auth via Bearer-Token
            (siehe <code class="font-mono">HERMES_AUTH_TOKEN</code>).
          </p>

          <div>
            <button
              type="button"
              class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium opacity-50"
              disabled
              title="Externe MCP-Server hinzufügen kommt mit Plan 32"
              data-testid="mcp-configure"
            >
              MCP-Server konfigurieren
            </button>
          </div>
        </template>
      </div>
    </section>

    <!-- ── Tool catalog ────────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="tools-section">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">Tools</h3>
        <p
          v-if="toolsApi.data.value"
          class="mt-0.5 text-xs text-muted-foreground"
          data-testid="tools-count"
        >
          {{ toolsApi.data.value.total }} Tools verfügbar
        </p>
        <p v-else class="mt-0.5 text-xs text-muted-foreground">
          Was der Agent heute aufrufen kann.
        </p>
      </header>

      <p
        v-if="toolsApi.loading.value && !toolsApi.data.value"
        class="p-3 text-xs text-muted-foreground"
        data-testid="tools-loading"
      >
        Lädt…
      </p>
      <p
        v-else-if="toolsApi.error.value"
        class="p-3 text-xs text-destructive"
        data-testid="tools-error"
      >
        {{ toolsApi.error.value }}
      </p>
      <p
        v-else-if="toolsApi.data.value && toolsApi.data.value.tools.length === 0"
        class="p-3 text-xs text-muted-foreground"
        data-testid="tools-empty"
      >
        Catalog leer — Backend nicht initialisiert?
      </p>
      <ul
        v-else-if="toolsApi.data.value"
        class="divide-y"
      >
        <li
          v-for="tool in toolsApi.data.value.tools"
          :key="tool.name"
          class="space-y-2 p-3"
          :data-testid="`tool-${tool.name}`"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p class="font-mono text-sm font-medium">{{ tool.name }}</p>
            <span
              :class="SOURCE_PILL_CLASS"
              :data-testid="`tool-source-${tool.name}`"
            >
              {{ sourceLabel(tool.source) }}
            </span>
            <span
              v-if="tool.requires_approval"
              class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
              :data-testid="`tool-approval-${tool.name}`"
            >
              <ShieldAlert class="size-3" aria-hidden="true" />
              Approval
            </span>
          </div>
          <p class="wrap-break-word text-xs text-muted-foreground">
            {{ tool.description }}
          </p>
          <p
            v-if="tool.requires_approval && tool.risk_reason"
            class="wrap-break-word text-xs text-amber-700 dark:text-amber-300"
          >
            {{ tool.risk_reason }}
          </p>

          <button
            type="button"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            :aria-expanded="expandedToolNames.has(tool.name)"
            :data-testid="`tool-toggle-${tool.name}`"
            @click="toggleTool(tool.name)"
          >
            <ChevronDown
              v-if="expandedToolNames.has(tool.name)"
              class="size-3.5"
              aria-hidden="true"
            />
            <ChevronRight
              v-else
              class="size-3.5"
              aria-hidden="true"
            />
            Parameter ansehen
          </button>
          <div
            v-if="expandedToolNames.has(tool.name)"
            :data-testid="`tool-schema-${tool.name}`"
          >
            <p
              v-if="!hasParameters(tool)"
              class="text-xs text-muted-foreground"
            >
              keine Parameter
            </p>
            <pre
              v-else
              class="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug"
              >{{ prettySchema(tool.parameters_schema) }}</pre>
          </div>

          <div>
            <button
              type="button"
              class="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium opacity-50"
              disabled
              title="Tool-Konfiguration kommt mit Plan 32 / 33"
              :data-testid="`tool-configure-${tool.name}`"
            >
              Konfigurieren
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
