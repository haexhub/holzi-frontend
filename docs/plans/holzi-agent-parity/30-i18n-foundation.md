# Plan 30: i18n-Foundation — DE/EN über UI + Backend-Error-Codes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task.

Status: **Planned.**

Cross-repo. Frontend-i18n + Backend-Error-Code-Refactor.

Depends on: [29-A](./29a-personas-and-channels.md) (Preferences-Seite
existiert; Sprach-Picker landet dort). Eingeordnet als
**Wave 0** von [Plan 35](./35-strategic-roadmap-2026h2.md) — alles
Folgende erbt i18n von Anfang an.

## Goal

`@nuxtjs/i18n` einrichten, alle UI-Strings extrahieren, DE und EN als
erste Sprachen, Sprach-Picker in `/settings/preferences`. Backend
liefert ab diesem Plan Error-Codes statt deutscher Strings, Frontend
übersetzt diese Codes lokal.

## Why

Hauptziel der Roadmap-Revision (siehe [Plan 35](./35-strategic-roadmap-2026h2.md))
ist „OSS-Produkt mit Usern". Eine Deutsch-only-UI kastriert die Reichweite ab
Tag eins, da der überwiegende Teil potenzieller OSS-User außerhalb DACH
sitzt. i18n ist außerdem foundational — jeder Plan ab Wave A shippt
bilingual von Anfang an, statt später nachzuziehen.

Backend-Error-Codes statt deutscher Strings ist konsistent mit der
**Failure Policy** aus Plan 35 (explicit failure, no silent recovery):
Backend gibt eindeutige Maschinen-Codes, Frontend rendert in der
gewählten Sprache.

## Non-Goals

- Locale-aware Date/Number-Formatting jenseits dessen, was `Intl` und
  `@nuxtjs/i18n` standardmäßig geben.
- RTL-Support.
- Externe Translation-Services / automatische Übersetzung. Manuelle
  DE/EN-JSONs.
- Backend hat *eigene* Locale-Pakete (`hermes/i18n/de.json`). Verworfen
  zugunsten Error-Codes — Backend ist sprach-agnostisch, FE übersetzt.
- Sprachen jenseits DE/EN. Erweiterbar via neue JSON-Datei +
  Picker-Option, aber nicht Scope dieses Plans.

## Architecture / Approach

### Frontend (Nuxt)

- `@nuxtjs/i18n` mit Locales `de` (default) + `en`, Strategy
  `prefix_except_default` (DE bleibt unter `/`, EN bekommt `/en/`-
  Prefix; manuelle User-Wahl 2026-06-04, überstimmt den initialen
  `no_prefix`-Vorschlag). Locale lebt zusätzlich im i18n-Cookie +
  `Accept-Language`-Fallback bei Erstbesuch.
- Lazy-Loading aus `app/i18n/locales/{de,en}.json`.
- Key-Hierarchie:
  - `common.*` — wiederverwendete Buttons, Labels („Speichern",
    „Abbrechen", „Löschen", „Bearbeiten", „Schließen", …).
  - `nav.*` — Navigation-Items (Control-Center-Sidebar + Mobile-Tabs).
  - `pages.<page>.*` — seitenspezifische Strings, ein Block pro Page.
  - `components.<component>.*` — komponentenspezifische Strings, wenn
    nicht trivial in `pages.*` integrierbar.
  - `errors.<CODE>` — Backend-Error-Code-Übersetzungen (UPPER_SNAKE
    Keys passend zu Backend `ErrorCode`-Enum).
- `setLocale()` aus `useI18n({ useScope: 'global' })` setzt Sprache +
  persistiert via i18n-Cookie + navigiert auf die Prefix-URL. **Wichtig:**
  ohne `useScope: 'global'` gibt vue-i18n im composition-mode einen
  lokalen Composer zurück, der keine `setLocale`-Augmentierung hat — der
  Call ist dann ein stiller no-op. Keine Backend-Persistenz (single-user;
  bei Wave C wird Locale dann per-user-Preference gespeichert).
- `detectBrowserLanguage: true` als initiale Auswahl; manuelle User-Wahl
  überschreibt.

### Backend (Hermes)

- Neue Datei `src/hermes/errors.py` definiert eine `ErrorCode`-Enum
  (StrEnum) mit allen User-actionable Fehler-Codes
  (`SLUG_CONFLICT`, `PERSONA_DEFAULT_DELETE`, `WORKSPACE_NOT_FOUND`,
  `AUTH_INVALID`, `LLM_CREDENTIAL_MISSING`, etc.).
- Alle `HTTPException(detail=…)`-Stellen in `src/hermes/routes/*.py`
  und Repository-Layer, die heute deutsche Strings raischen, werden
  auf `detail=ErrorCode.X.value` umgestellt.
- Backend ist ab da locale-agnostisch — keine User-sichtbaren Strings
  mehr im Backend. Diagnostics-Texte (Plan 20), die heute deutsch
  sind, werden ebenfalls auf Code+Param-Struktur umgestellt
  (`{ "code": "SANDBOX_WARNING", "params": { "reason": "…" } }`).
- `Accept-Language`-Parsing wird **nicht** benötigt — Backend
  übergibt Code, FE entscheidet Sprache.

### Frontend-Error-Rendering

- Neuer Helper `app/lib/errorMessages.ts`:
  ```ts
  export function translateError(error: unknown, t: TranslateFn): string {
    const code = extractCode(error)  // aus error.detail oder error.code
    if (code && hasI18nKey(`errors.${code}`)) return t(`errors.${code}`)
    return t('errors.GENERIC') + (code ? ` (${code})` : '')
  }
  ```
- Alle bestehenden `useFoo`-Composables, die heute Strings wie
  `'Fehler beim Laden.'` raisen, werden auf `translateError(err, t)`
  umgestellt.
- Fallback: unbekannte Codes zeigen generischen Text + Code in
  Klammern (für Debugging).

### Tests

- Neuer Test `tests/i18n/keys.test.ts` — assert dass alle Keys in
  `de.json` auch in `en.json` existieren (no orphans, no missing).
- Neuer Test `tests/i18n/error-codes.test.ts` — assert dass alle
  Backend-`ErrorCode`-Enum-Werte als `errors.X`-Key in beiden Locales
  existieren. Datenquelle: `app/types/api-generated.ts` (kommt aus
  `pnpm run gen:api`).
- Bestehende Component-Tests: die meisten asserten heute auf deutsche
  Strings — pro Page-Extraktion werden sie mitgeführt (entweder
  assert auf den i18n-Key via `vi.mock('@nuxtjs/i18n')` oder auf das
  DE-Render-Result, je nach Stil).

## Scope

### Frontend-String-Extraktion (geschätzt 250–400 Stellen)

- `app/pages/**/*.vue` — Page-Titles, Section-Headers, Buttons,
  Empty-States.
- `app/components/**/*.vue` — alle sichtbaren Strings.
- `app/composables/**/*.ts` — Error-Fallback-Strings (`'Fehler beim
  Laden.'` → `t('errors.LOAD_FAILED')` oder
  `translateError(err, t)`).
- `app/layouts/**/*.vue` — Nav-Labels, Sidebar.
- `app/lib/settingsNav.ts` — `label`- und `upcoming`-Felder werden
  zu i18n-Keys (z.B. `nav.preferences.label`).

### Backend-Error-Code-Migration

Audit aller `HTTPException(detail=…)` / `raise … detail="…"` in
`src/hermes/`:
- `src/hermes/routes/*.py` (alle Routen)
- `src/hermes/repository/*.py` (Validation-Errors die als
  ValueErrors raisen, die dann in Routen zu HTTPExceptions werden)
- `src/hermes/main.py` (Lifespan-Errors)

Pro `detail=…`-Stelle:
- Wenn deutscher String → in `ErrorCode`-Enum aufnehmen, Stelle
  umstellen.
- Wenn englischer technischer Name (z.B. „bad request body") →
  bleibt wie ist, wenn er für User unverständlich aber Code-
  technisch korrekt ist. Sonst auch Enum-Code.
- Diagnostics-Output (`/api/diagnostics`) wird auf
  `{ code, params }`-Struktur umgestellt.

## Tasks

Die Tasks sind so geschnitten, dass jede Task in eine Session passt.
TDD-Philosophie: erst Test schreiben, dann Impl, dann commit.

### Task 1: Foundation + Common-Keys + Sprach-Picker

**Files:**
- Create: `app/i18n/locales/de.json`, `app/i18n/locales/en.json`
- Modify: `nuxt.config.ts` (i18n-Modul + Config)
- Modify: `app/pages/settings/preferences.vue` (Sprach-Picker als
  dritte Section)
- Create: `tests/i18n/keys.test.ts`
- Modify: `package.json` (`@nuxtjs/i18n`-Dep)

**Steps:**

1. `pnpm add @nuxtjs/i18n` und in `nuxt.config.ts` als Modul
   konfigurieren mit Locales/Strategy/Lazy.
2. Initiale `de.json` mit `common.{save,cancel,delete,edit,close,
   loading,error,retry,confirm}` + `nav.{preferences,llm,memory,
   tasks,workspaces,skills,diagnostics,insights,logs}.label` +
   `errors.{GENERIC,NETWORK,UNKNOWN}`.
3. `en.json` 1:1 manuell übersetzen (gleiche Keys, englische Werte).
4. `tests/i18n/keys.test.ts` schreiben: Test failed wenn de.json und
   en.json unterschiedliche Key-Sets haben.
5. Run: `pnpm vitest run tests/i18n/keys.test.ts` → PASS.
6. Sprach-Picker als dritte Section in `/settings/preferences`:
   Select mit DE/EN, `setLocale()`-Aufruf bei Change. Test:
   `tests/components/PreferencesPage.test.ts` ergänzen um „picker
   change calls setLocale".
7. Eine Sample-Page (Vorschlag: `app/pages/settings/llm.vue` weil
   relativ klein) komplett auf i18n umstellen. Tests für diese Page
   anpassen.
8. Commit: `feat(i18n): foundation + common keys + Sprachpicker`

### Task 2: Backend Error-Code-Enum + Audit

**Files:**
- Create: `src/hermes/errors.py` (StrEnum)
- Modify: alle `src/hermes/routes/*.py` mit deutschen `detail=`-
  Strings
- Modify: `src/hermes/routes/diagnostics.py` (output-Struktur auf
  `{code, params}`)
- Modify: betroffene `tests/test_api_*.py` (assertieren jetzt auf
  Code statt String)

**Steps:**

1. `grep -rn 'detail=' src/hermes/routes/` ausführen, alle deutschen
   Strings sammeln. Erwartete Anzahl: ~30–60 Stellen.
2. `src/hermes/errors.py` mit `class ErrorCode(StrEnum)` schreiben,
   pro gefundener Stelle einen UPPER_SNAKE-Code. Beispiele:
   `SLUG_CONFLICT = "SLUG_CONFLICT"`,
   `PERSONA_DEFAULT_DELETE = "PERSONA_DEFAULT_DELETE"`,
   `WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"`.
3. Test schreiben (`tests/test_errors_enum.py`): assert dass jeder
   Enum-Wert == Name (StrEnum-Konvention) und dass die Enum nicht
   leer ist.
4. Pro Route-File: alle deutschen `detail=…` durch
   `detail=ErrorCode.X.value` ersetzen. Tests in
   `tests/test_api_*.py` anpassen: `assert resp.json()['detail']
   == "SLUG_CONFLICT"` statt `assert "existiert" in
   resp.json()['detail']`.
5. `routes/diagnostics.py` Output-Struktur auf
   `{ subsystem, status, code, params }` umstellen. Tests
   entsprechend.
6. Run: `cd /home/haex/Projekte/Holzi && uv run pytest` →
   alle PASS.
7. Run: `uv run ruff check src/` + `uv run mypy src/` → clean.
8. Commit (Backend-Repo): `feat(errors): introduce ErrorCode enum,
   migrate routes from german strings`

### Task 3: Frontend Error-Rendering-Helper + Composable-Migration

**Files:**
- Create: `app/lib/errorMessages.ts`
- Modify: alle `app/composables/use*.ts` die heute deutsche
  Fallback-Strings haben
- Modify: `app/i18n/locales/{de,en}.json` (alle `errors.*`-Keys aus
  Task 2 ergänzen)
- Create: `tests/lib/errorMessages.test.ts`
- Modify: `app/pages/api-generated.ts` (kommt aus `pnpm run gen:api`
  nach Task 2)

**Steps:**

1. Nach Task 2 mergen: `pnpm run gen:api` ausführen, generated types
   updaten.
2. `app/lib/errorMessages.ts` schreiben mit `translateError(err, t)`-
   Helper. Test schreiben für: bekannter Code, unbekannter Code,
   null/undefined error, network error ohne Response.
3. Test laufen, FAIL erwartet.
4. Helper implementieren, Test PASS.
5. Pro Composable mit Fallback-String: `'Fehler beim Laden.'` durch
   `translateError(err, t)` ersetzen. Composable-Tests anpassen.
6. `de.json`/`en.json` um alle `errors.<CODE>`-Keys ergänzen, die
   in Task 2 erzeugt wurden. Lookup auf Code-Enum aus
   `api-generated.ts`.
7. Neuer Test `tests/i18n/error-codes.test.ts`: iteriert über
   `ErrorCode`-Enum (importiert aus `api-generated.ts`), assertet
   dass jeder Wert sowohl in `de.json` als auch `en.json` als
   `errors.<value>` existiert.
8. Run: `pnpm vitest run` → alle PASS.
9. Commit: `feat(i18n): error-code rendering helper +
   composable migration`

### Task 4: Page-by-Page-Extraktion

**Files:** alle `app/pages/**/*.vue` und betroffene Components.

**Approach:** Pro Page-File (~10–15 Pages):
1. Alle hartkodierten deutschen Strings in `<template>` und
   `<script>` lokalisieren.
2. Page-spezifische Keys unter `pages.<pagename>.*` in beide
   Locale-Files schreiben.
3. Page umstellen.
4. Component-Test für diese Page anpassen (assertet entweder auf
   i18n-Key oder auf das DE-Render-Result je nach existierendem
   Stil).
5. Smoke: `pnpm dev` starten, Page in DE öffnen, Locale auf EN
   wechseln, Page öffnen → kein Key-String („pages.tasks.title")
   leakt ins DOM.

Reihenfolge (klein → groß, damit man früh Routine entwickelt):
- `settings/{insights,logs,llm}` (klein)
- `settings/{memory,tasks,workspaces}` (mittel)
- `settings/{skills,preferences,diagnostics}` (mittel)
- `chat/index` + `ChatHub.vue` (groß, viele Strings)
- `EmptyChatState.vue`, `ChatComposer.vue`,
  `MessageList.vue` (zentrale Chat-Komponenten)

**Schritt-Größe:** Pro Page ein Commit. Diese Task läuft über mehrere
Sessions; ggf. als 4a/4b/4c/4d aufteilen, wenn der Plan zu lang
wird.

### Task 5: ESLint-Rule + Smoke-Verifikation

**Files:**
- Modify: `eslint.config.ts` (aktiviere `@nuxtjs/i18n/no-raw-text`-
  Rule)
- Lint-fix-Run.

**Steps:**

1. ESLint-Rule `@nuxtjs/i18n/no-raw-text` aktivieren als ERROR.
2. `pnpm lint` ausführen, alle Restlücken sammeln. Erwartet: 0–10
   Findings (überwiegend Übersehene Strings aus Task 4).
3. Restlücken fixen pro Page-File, Commits klein halten.
4. Manuelle Verifikation: Dev-Stack hochfahren, jede Page in beiden
   Sprachen öffnen, keine deutschen Resstrings in EN-Mode finden.
5. Commit: `chore(i18n): enable no-raw-text rule + final cleanup`

## Verification

- `pnpm vitest run` → alle Tests grün, inkl. `tests/i18n/*`.
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0 mit aktiver `no-raw-text`-Rule.
- Backend: `uv run pytest` → alle Tests grün, inkl.
  `tests/test_errors_enum.py`.
- Backend: `uv run ruff check src/` + `uv run mypy src/` → clean.
- Live-Smoke via `make up-local-full`:
  - Frontend startet, Default-Locale ist Browser-Locale (DE bei
    `de-DE`-Browser, EN bei `en-US`-Browser).
  - Sprach-Picker in `/settings/preferences` wechselt Locale, alle
    Pages re-rendern.
  - Provoziertes Backend-Error (z.B. duplicate Persona-Slug) zeigt
    übersetzte Fehlermeldung in beiden Locales.

## Open Questions

Beide aus dem ursprünglichen Plan-30-Entwurf abgeräumt:

- **EN-Vollständigkeit**: zwingend vollständig, Test enforced.
  Lückenhaft + Fallback-auf-DE wäre UX-Bruch (deutsche Wörter
  würden in EN-UI leaken).
- **Browser-Locale-Detection**: ja, via `detectBrowserLanguage:
  true`. Manuelle Wahl in `/settings/preferences` überschreibt.

Neu:

- **Wave-C-Vorgriff**: Sollten wir Locale schon jetzt in der
  `users`-Tabelle (kommt erst in Wave C) vorsehen? → Nein, bleibt
  Cookie-based bis Wave C. Migration auf Per-User-Locale ist
  trivial nachrüstbar.

## Risk Register

| Risk | Mitigation |
|---|---|
| Backend-Error-Code-Migration bricht eine Route, die niemand bewusst testet | Task 2 erzwingt assert-auf-Code in jedem `test_api_*.py`. Wenn Test fehlt, ist Route nicht abgedeckt → vor Migration Test ergänzen. |
| EN-Übersetzungen schlecht / wörtlich | DE → EN manuell, Code-Reviewer prüft auf natürliches Englisch. Nicht maschinell. |
| 250–400 Strings explodieren auf 800 weil Komponenten dynamische Strings haben | Vor Task 4 ein `rg '">[A-ZÄÖÜ]'`-Sweep, um die echte Anzahl zu zählen. Plan ggf. neu schätzen. |
| Component-Tests gegen deutsche Strings brechen flächendeckend | Pro Page-Extraktion in Task 4 die Tests *als Teil derselben Commit*, nicht separat. So bleibt CI green. |
