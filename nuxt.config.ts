import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // SPA — no SSR. The hermes-server serves the built dist/ statically.
  ssr: false,

  modules: ['shadcn-nuxt', '@pinia/nuxt', '@vueuse/nuxt'],

  css: ['~/assets/css/tailwind.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },

  devServer: {
    port: 3001,
  },

  // Proxy /api/* to hermes-server during `nuxt dev`. Hermes listens on 8082.
  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost:8082/api',
        changeOrigin: true,
      },
    },
  },
})
