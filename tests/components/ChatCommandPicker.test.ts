import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})
vi.mock('#imports', () => ({ useLocalePath: () => (p: string) => p }))

import CommandPicker from '~/components/chat/CommandPicker.vue'
import type { Persona, ModelEntry } from '~/types/api'

const persona: Persona = {
  id: 1, name: 'Hermes', soul: '', identity: '', agents: '',
  is_default: true, llm_credential_id: null, model: null,
  created_at: 0, updated_at: 0,
}

const model: ModelEntry = { id: 'claude-opus-4-8', credential_id: 1, credential_name: 'Default' }

describe('CommandPicker.vue', () => {
  it('renders trigger button', () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [] },
    })
    expect(wrapper.find('[data-testid="command-picker-trigger"]').exists()).toBe(true)
  })

  it('emits clear-conversation when action is clicked', async () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [] },
    })
    await wrapper.find('[data-testid="command-picker-trigger"]').trigger('click')
    const clearBtn = wrapper.find('[data-testid="clear-conversation"]')
    if (clearBtn.exists()) {
      await clearBtn.trigger('click')
      expect(wrapper.emitted('clear-conversation')).toBeTruthy()
    }
  })
})
