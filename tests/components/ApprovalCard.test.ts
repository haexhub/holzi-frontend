import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ApprovalCard from '~/components/chat/ApprovalCard.vue'

const baseApproval = {
  name: 'cross_channel_send',
  arguments: { channel: 'signal', message: 'hi' },
  reason: 'Sends a real message to your linked Signal account.',
}

describe('ApprovalCard.vue', () => {
  it('shows the risk reason, tool name and arguments while pending', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    expect(wrapper.text()).toContain('Bestätigung erforderlich')
    expect(wrapper.text()).toContain('linked Signal account')
    expect(wrapper.text()).toContain('cross_channel_send')
    // Arguments are rendered.
    expect(wrapper.text()).toContain('channel')
    expect(wrapper.text()).toContain('signal')
  })

  it('emits the decision when a button is clicked', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    const buttons = wrapper.findAll('button')
    const allow = buttons.find((b) => b.text().includes('erlauben'))
    const deny = buttons.find((b) => b.text().includes('Ablehnen'))
    expect(allow).toBeTruthy()
    expect(deny).toBeTruthy()

    await allow!.trigger('click')
    await deny!.trigger('click')
    expect(wrapper.emitted('decide')).toEqual([['allow_once'], ['deny']])
  })

  it('disables the buttons while a decision is submitting', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'submitting' },
    })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('hides the buttons and shows a verdict once decided', () => {
    const allowed = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'allowed' },
    })
    expect(allowed.findAll('button')).toHaveLength(0)
    expect(allowed.text()).toContain('Erlaubt')

    const denied = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'denied' },
    })
    expect(denied.findAll('button')).toHaveLength(0)
    expect(denied.text()).toContain('Abgelehnt')
  })
})
