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
├── types/
│   ├── api.ts                  # public type surface: re-exports request bodies from generated, response shapes hand-rolled (see TODO)
│   └── api-generated.ts        # auto-generated from hermes openapi — do not edit
```

## Regenerating API types

```bash
HERMES_AUTH_TOKEN=… pnpm run gen:api   # requires hermes-server running on :8082
```

This pulls the OpenAPI schema from the live server (it's Bearer-gated) and regenerates `app/types/api-generated.ts`. Commit the result.

## Open items

- Backend follow-up: add `response_model=` to each FastAPI endpoint so response shapes become named schemas in `/openapi.json` — then the hand-rolled response types in `app/types/api.ts` can move into the generated file too.
- Streaming-text rendering already incremental on the server side (PR #8 in Holzi); the UI animates token-by-token automatically since `useChatStream` concatenates each SSE `text` event.
