import {
  Activity,
  Cpu,
  Database,
  FolderTree,
  ListChecks,
  MessageSquare,
  SlidersHorizontal,
  Wrench,
} from 'lucide-vue-next'
import type { Component } from 'vue'

export interface SettingsNavItem {
  to: string
  label: string
  icon: Component
  /** undefined for shipped sections, otherwise a short hint for the placeholder. */
  upcoming?: string
}

export const settingsNav: readonly SettingsNavItem[] = [
  { to: '/settings/llm', label: 'LLM', icon: Cpu },
  { to: '/settings/messenger', label: 'Messenger', icon: MessageSquare },
  { to: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal, upcoming: 'Agent-weite Einstellungen wie Sprache, Default-Modell, Tastatur.' },
  { to: '/settings/memory', label: 'Memory', icon: Database },
  { to: '/settings/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/settings/skills', label: 'Skills & Tools', icon: Wrench, upcoming: 'Skills, MCP-Server und Tools, die der Agent ausführen darf.' },
  { to: '/settings/workspaces', label: 'Workspaces', icon: FolderTree, upcoming: 'Verwaltung der Workspaces inkl. Sandbox-Zustand und Disk-Quotas.' },
  { to: '/settings/diagnostics', label: 'Diagnostics', icon: Activity, upcoming: 'Run-History, Sandbox-Crashes, Health-Checks (Plan 20).' },
] as const
