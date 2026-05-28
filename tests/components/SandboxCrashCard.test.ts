import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SandboxCrashCard from '~/components/chat/SandboxCrashCard.vue'
import type { SandboxCrashedData } from '~/types/api'

const baseCrash: SandboxCrashedData = {
  workspace_id: 'ws-abc-123',
  sandbox_id: 'sb-xyz-789',
  state: 'crashed',
  exit_code: 137,
}

describe('SandboxCrashCard.vue', () => {
  it('renders the workspace id, state label and exit code', () => {
    const wrapper = mount(SandboxCrashCard, {
      props: { crash: baseCrash, restarting: false },
    })
    expect(wrapper.text()).toContain('Sandbox abgestürzt')
    expect(wrapper.text()).toContain('ws-abc-123')
    expect(wrapper.text()).toContain('Abgestürzt')
    expect(wrapper.text()).toContain('137')
  })

  it('emits restart when the Neustart button is clicked', async () => {
    const wrapper = mount(SandboxCrashCard, {
      props: { crash: baseCrash, restarting: false },
    })
    const restart = wrapper.findAll('button').find((b) => b.text().includes('Neustart'))
    expect(restart).toBeTruthy()
    await restart!.trigger('click')
    expect(wrapper.emitted('restart')).toEqual([[]])
  })

  it('emits dismiss when the Schließen button is clicked', async () => {
    const wrapper = mount(SandboxCrashCard, {
      props: { crash: baseCrash, restarting: false },
    })
    const dismiss = wrapper.findAll('button').find((b) => b.text().includes('Schließen'))
    expect(dismiss).toBeTruthy()
    await dismiss!.trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([[]])
  })

  it('disables buttons and shows progress text while restarting', () => {
    const wrapper = mount(SandboxCrashCard, {
      props: { crash: baseCrash, restarting: true },
    })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    expect(wrapper.text()).toContain('Wird neu gestartet')
  })

  it('does not emit when buttons are clicked while restarting', async () => {
    const wrapper = mount(SandboxCrashCard, {
      props: { crash: baseCrash, restarting: true },
    })
    for (const button of wrapper.findAll('button')) {
      await button.trigger('click')
    }
    expect(wrapper.emitted('restart')).toBeUndefined()
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('shows the OOM-specific German label for state="oom"', () => {
    const wrapper = mount(SandboxCrashCard, {
      props: {
        crash: { ...baseCrash, state: 'oom' },
        restarting: false,
      },
    })
    expect(wrapper.text()).toContain('Speicher erschöpft')
    expect(wrapper.text()).not.toContain('Abgestürzt')
  })
})
