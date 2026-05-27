import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatComposer from '~/components/chat/ChatComposer.vue'

function addFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true,
  })
  return input.trigger('change')
}

describe('ChatComposer.vue', () => {
  it('emits send with the trimmed text and no files', async () => {
    const wrapper = mount(ChatComposer)
    await wrapper.find('textarea').setValue('  hello  ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('send')).toEqual([[{ text: 'hello', files: [] }]])
  })

  it('does not emit when the text is empty even with a file attached', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'a.txt', { type: 'text/plain' }))
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('shows a chip for a picked file and includes it in the send payload', async () => {
    const wrapper = mount(ChatComposer)
    const file = new File(['hello'], 'log.txt', { type: 'text/plain' })
    await addFile(wrapper, file)
    expect(wrapper.text()).toContain('log.txt')

    await wrapper.find('textarea').setValue('check this')
    await wrapper.find('form').trigger('submit')
    const events = wrapper.emitted('send')
    expect(events).toHaveLength(1)
    const payload = events![0]![0] as { text: string; files: File[] }
    expect(payload.text).toBe('check this')
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]!.name).toBe('log.txt')
  })

  it('removes a picked file before send', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'remove-me.txt', { type: 'text/plain' }))
    expect(wrapper.text()).toContain('remove-me.txt')

    // The chip's remove button is the only button rendered in the preview row.
    const removeButton = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.includes('remove-me.txt'))
    expect(removeButton).toBeTruthy()
    await removeButton!.trigger('click')
    expect(wrapper.text()).not.toContain('remove-me.txt')
  })

  it('clears text and files after a send', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'gone.txt', { type: 'text/plain' }))
    await wrapper.find('textarea').setValue('bye')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).not.toContain('gone.txt')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
})
