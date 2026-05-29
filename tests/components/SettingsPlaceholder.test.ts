import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlaceholderSection from '~/components/settings/PlaceholderSection.vue'
import { settingsNav } from '~/lib/settingsNav'

// The placeholder pages all render this component; it looks up the
// current route in `settingsNav` and shows label + upcoming hint. These
// tests guard against accidental nav-model breakage (typo in a `to`,
// dropped upcoming hint, etc).

const currentPath = { value: '/' }

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get path() {
      return currentPath.value
    },
  }),
}))

function mountAtRoute(path: string) {
  currentPath.value = path
  return mount(PlaceholderSection)
}

describe('settingsNav model', () => {
  it('exposes one entry per Control Center section', () => {
    const tos = settingsNav.map((n) => n.to)
    expect(tos).toEqual([
      '/settings/llm',
      '/settings/messenger',
      '/settings/preferences',
      '/settings/memory',
      '/settings/tasks',
      '/settings/skills',
      '/settings/workspaces',
      '/settings/diagnostics',
    ])
  })

  it('flags placeholder sections with an upcoming hint and shipped sections without', () => {
    const shipped = settingsNav.filter((n) => !n.upcoming).map((n) => n.to)
    expect(shipped).toEqual(['/settings/llm', '/settings/messenger'])
    for (const item of settingsNav) {
      if (!shipped.includes(item.to)) {
        expect(item.upcoming, `${item.to} should have an upcoming hint`).toBeTruthy()
      }
    }
  })
})

describe('PlaceholderSection', () => {
  it('renders the label + upcoming hint for the active placeholder route', () => {
    const wrapper = mountAtRoute('/settings/memory')
    expect(wrapper.text()).toContain('Memory')
    expect(wrapper.text()).toContain('Plan 15')
    expect(wrapper.text()).toContain('noch nicht implementiert')
  })

  it('renders nothing when the route is not in the nav model', () => {
    const wrapper = mountAtRoute('/settings/unknown')
    expect(wrapper.text()).toBe('')
  })
})
