import { createPinia, setActivePinia } from 'pinia'
import { beforeEach } from 'vitest'

// Fresh Pinia per test so stores don't leak state between cases.
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})
