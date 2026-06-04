import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListChecks,
  SlidersHorizontal,
  Wrench,
} from 'lucide-vue-next'

export interface SettingsNavItem {
  to: string
  label: string
  icon: Component
  /** undefined for shipped sections, otherwise a short hint for the placeholder. */
  upcoming?: string
}

export const settingsNav: readonly SettingsNavItem[] = [
  { to: '/settings/llm', label: 'LLM', icon: Cpu },
  { to: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { to: '/settings/memory', label: 'Memory', icon: Database },
  { to: '/settings/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/settings/skills', label: 'Skills & Tools', icon: Wrench },
  { to: '/settings/workspaces', label: 'Workspaces', icon: FolderTree },
  { to: '/settings/diagnostics', label: 'Diagnostics', icon: Activity },
  { to: '/settings/insights', label: 'Insights', icon: BarChart3 },
  { to: '/settings/logs', label: 'Logs', icon: FileText },
] as const
