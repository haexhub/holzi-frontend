import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SubagentCard from '~/components/chat/SubagentCard.vue'

describe('SubagentCard.vue', () => {
  it('renders a running subagent with its name and is expandable when it has a task', async () => {
    const wrapper = mount(SubagentCard, {
      props: {
        subagent: {
          name: 'researcher',
          prompt: 'find the population of Berlin',
          status: 'running',
          text: '',
          result: null,
          error: null,
        },
      },
    })
    expect(wrapper.text()).toContain('researcher')
    expect(wrapper.text()).toContain('Läuft')
    // Collapsed: task hidden until expanded.
    expect(wrapper.text()).not.toContain('population of Berlin')

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('find the population of Berlin')
  })

  it('shows the result of a finished subagent when expanded', async () => {
    const wrapper = mount(SubagentCard, {
      props: {
        subagent: {
          name: 'researcher',
          prompt: null,
          status: 'success',
          text: 'streamed bits',
          result: '3.7 million',
          error: null,
        },
      },
    })
    expect(wrapper.text()).toContain('Fertig')
    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('3.7 million')
  })

  it('surfaces the error of a failed subagent', async () => {
    const wrapper = mount(SubagentCard, {
      props: {
        subagent: {
          name: 'worker',
          prompt: null,
          status: 'error',
          text: '',
          result: null,
          error: 'timed out',
        },
      },
    })
    expect(wrapper.text()).toContain('Fehler')
    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('timed out')
  })

  it('is not expandable with no task or output', async () => {
    const wrapper = mount(SubagentCard, {
      props: {
        subagent: {
          name: 'worker',
          prompt: null,
          status: 'running',
          text: '',
          result: null,
          error: null,
        },
      },
    })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(wrapper.find('pre').exists()).toBe(false)
  })
})
