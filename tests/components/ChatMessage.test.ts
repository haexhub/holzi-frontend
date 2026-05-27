import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessage from '~/components/chat/ChatMessage.vue'

// Stub the (async, shiki-backed) Markdown renderer so these tests stay fast
// and focused on ChatMessage's routing.
const stubs = {
  RenderedMarkdown: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div class="rm-stub">{{ content }}</div>',
  },
}

describe('ChatMessage.vue', () => {
  it('renders assistant messages through RenderedMarkdown', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: '# Hi' } },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(true)
    expect(wrapper.find('.rm-stub').text()).toBe('# Hi')
  })

  it('renders user messages as plain text, not Markdown', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'user', content: '# not a heading' } },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('# not a heading')
  })

  it('keeps the streaming bubble plain even though it is an assistant message', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: '# live token' }, plain: true },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('# live token')
  })

  it('shows a timestamp when ts is provided', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: 'hi', ts: 1716800000 }, canRetry: false },
      global: { stubs },
    })
    const ts = wrapper.find('.message-ts')
    expect(ts.exists()).toBe(true)
    expect(ts.text()).toMatch(/\d/)
  })

  it('omits the timestamp when ts is absent (e.g. streaming bubble)', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: 'streaming…' } },
      global: { stubs },
    })
    expect(wrapper.find('.message-ts').exists()).toBe(false)
  })
})
