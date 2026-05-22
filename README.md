# holzi-frontend

Nuxt 4 + shadcn-vue SPA for the [Hermes personal-agent backend](https://github.com/haexhub/Holzi). Talks to `hermes-server` over `/api/*` (REST) and `/api/chat` (SSE).

## Stack

- **Nuxt 4** (SSR off — built as a static SPA)
- **Vue 3** + Composition API + TypeScript
- **Tailwind 4** + **shadcn-vue** primitives (in `app/components/ui/`)
- **Pinia** for store, **VueUse** for composables
- **pnpm** for installs

## Auth

Bearer token entered on `/login`, persisted in `localStorage` via VueUse. All API requests carry an `Authorization: Bearer …` header. A 401 from the API clears the stored token and bounces the user back to the login screen.

Conversations and messages themselves live in the server's SQLite — the frontend re-fetches via `/api/conversations/{id}` rather than caching them client-side.

## Dev

Backend (in the `Holzi/` repo, separate clone):

```bash
HERMES_AUTH_TOKEN=$(openssl rand -hex 32) make dev   # listens on :8082
```

Frontend:

```bash
pnpm install
pnpm dev   # http://localhost:3001  (proxies /api → http://localhost:8082/api)
```

## Production

The build artefact lives at `.output/public/`. The hermes-server is expected to serve this directory as static files from `/opt/hermes/frontend/dist` (see the Phase 10 deploy step).

```bash
pnpm build      # full Nuxt build (SSR + SPA)
pnpm generate   # static-only SPA → .output/public/
```

## Layout

```
app/
├── app.vue                     # NuxtLayout + NuxtPage shell
├── layouts/default.vue         # plain bg + slot
├── middleware/auth.global.ts   # redirects unauth → /login
├── pages/
│   ├── index.vue               # 3-col: sidebar | chat | panels
│   └── login.vue               # Bearer-token entry
├── components/
│   ├── chat/                   # ConversationList, ChatMessage, ChatComposer
│   ├── panels/                 # NotesPanel, TodosPanel, RemindersPanel
│   └── ui/                     # shadcn-vue primitives
├── composables/
│   ├── useApi.ts               # $fetch + Bearer + 401-handler
│   └── useChatStream.ts        # fetch + SSE parser for /api/chat
├── stores/auth.ts              # token persisted in localStorage
├── lib/utils.ts                # cn() (clsx + tailwind-merge)
└── types/api.ts                # hand-rolled API shapes (TODO: openapi-typescript)
```

## Open items

- Wire `openapi-typescript` against the hermes `/openapi.json` so `types/api.ts` is auto-generated.
- Streaming-text rendering: backend currently emits one final `text` event after the full agent turn — add token-level SSE on the backend and render incremental text here.
