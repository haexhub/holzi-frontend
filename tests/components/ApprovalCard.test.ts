import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ApprovalCard from '~/components/chat/ApprovalCard.vue'

const baseApproval = {
  name: 'cross_channel_send',
  arguments: { channel: 'signal', message: 'hi' },
  reason: 'Sends a real message to your linked Signal account.',
}

function clickByLabel(buttons: ReturnType<ReturnType<typeof mount>['findAll']>, label: string) {
  const btn = buttons.find((b) => b.text().includes(label))
  if (!btn) throw new Error(`button with label "${label}" not found`)
  return btn
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

  it('renders the four Plan 21 decision buttons', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toEqual(
      expect.arrayContaining([
        'Ablehnen',
        'Einmal erlauben',
        'In dieser Session',
        expect.stringContaining('Immer erlauben'),
      ]),
    )
  })

  it('emits each decision with no reason when the textarea stays hidden', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    const buttons = wrapper.findAll('button')

    await clickByLabel(buttons, 'Ablehnen').trigger('click')
    await clickByLabel(buttons, 'Einmal erlauben').trigger('click')
    await clickByLabel(buttons, 'In dieser Session').trigger('click')
    await clickByLabel(buttons, 'Immer erlauben').trigger('click')

    expect(wrapper.emitted('decide')).toEqual([
      [{ decision: 'deny' }],
      [{ decision: 'allow_once' }],
      [{ decision: 'allow_session' }],
      [{ decision: 'allow_always' }],
    ])
  })

  it('round-trips a reason from the textarea into the emit payload', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    // Textarea is collapsed by default — expand it via the "Mit Begründung" link.
    const expand = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Mit Begründung'))
    expect(expand).toBeTruthy()
    await expand!.trigger('click')

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('  this would page oncall  ')

    await clickByLabel(wrapper.findAll('button'), 'Ablehnen').trigger('click')

    // Reason is trimmed before emit.
    expect(wrapper.emitted('decide')).toEqual([
      [{ decision: 'deny', reason: 'this would page oncall' }],
    ])
  })

  it('caps the reason textarea at 500 characters', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Mit Begründung'))!
      .trigger('click')
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('maxlength')).toBe('500')
  })

  it('disables every decision button while a decision is submitting', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'submitting' },
    })
    const buttons = wrapper
      .findAll('button')
      .filter((b) => !b.text().includes('Mit Begründung'))
    expect(buttons.length).toBe(4)
    for (const button of buttons) {
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
