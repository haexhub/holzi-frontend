# Plan 30: i18n-Foundation — Sprache als Preference (DE/EN)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Frontend-only. Mehrtägiger Refactor. Eigene Session(s).

Depends on: [29-A](./29a-personas-and-channels.md) (Preferences-Seite
existiert; Sprach-Picker landet dort).

## Goal

`@nuxtjs/i18n` einrichten, alle UI-Strings extrahieren, DE und EN als
erste Sprachen, Sprach-Picker in `/settings/preferences`.

Backend bleibt unangetastet — die UI ist die einzige sichtbare Stelle
heute, an der Deutsch hart verdrahtet ist. System-Prompts (29-A) sind
User-Content, kein UI-Content.

## Why

Roadmap-README ordnet i18n bewusst zurück: *„pure FE aber a multi-day
refactor; do when localisation actually has a user"*. Diese Session ist
ausgelöst durch den expliziten Wunsch, die Sprache in den Preferences
festlegen zu können — der Trigger ist erreicht.

## Non-Goals

- Backend-i18n (Error-Messages, Diagnostics-Texte). Bleibt Deutsch
  (System-User-Domain).
- Locale-aware Date/Number-Formatting jenseits dessen, was `Intl` und
  `@nuxtjs/i18n` standardmäßig geben.
- RTL-Support.
- Externe Translation-Services / automatische Übersetzung. Manuelle
  DE/EN-JSONs.

## Scope

### Foundation

- Dependency `@nuxtjs/i18n` hinzufügen, in `nuxt.config.ts` einrichten:
  - Locales: `de` (default), `en`.
  - Strategy: `no_prefix` (URLs bleiben unverändert; Locale lebt in
    Cookie/Header).
  - Lazy-loading der Sprachpakete aus `app/i18n/locales/`.
- Datei `app/i18n/locales/de.json` (Hauptsprache, vollständige Keys).
- Datei `app/i18n/locales/en.json` (initial 1:1 übersetzt).

### String-Extraktion

Systematisch alle hartkodierten Texte durchgehen (geschätzt 250–400
Stellen):

- `app/pages/**/*.vue` — Page-Titles, Buttons, Section-Headers.
- `app/components/**/*.vue` — alle sichtbaren Strings.
- `app/composables/**/*.ts` — Error-Fallbacks (`'Fehler beim Laden.'`).
- `app/layouts/**/*.vue` — Nav-Labels, Sidebar.
- `app/lib/settingsNav.ts` — die `label` und `upcoming` Felder.

Pattern: aus `<span>Speichern</span>` wird `<span>{{ t('common.save')
}}</span>`. Aus `'Fehler beim Laden.'` wird `t('common.load_error')`.

Key-Hierarchie:
- `common.*` für wiederverwendete Buttons/Labels.
- `pages.<page>.*` für seitenspezifische Strings.
- `errors.*` für Fallback-Error-Messages.
- `nav.*` für Nav-Items.

### Sprach-Picker

- In `app/pages/settings/preferences.vue` (aus 29-A) eine dritte Section
  „Sprache" mit einem `<select>` (DE / EN).
- Wechsel ruft `setLocale()` von `useI18n()`.
- Persistenz via `@nuxtjs/i18n`-Cookie; kein Backend-Sync (single-
  user).

### Tests

- Bestehende Component-Tests müssen weiter grün sein. Die meisten
  asserten gegen die deutschen Strings — diese werden Test-für-Test
  mitgeführt: entweder Tests assert auf den Key, oder auf das DE-
  Render-Result (häufiger).
- Neuer Test `tests/i18n.test.ts` — alle Keys in `de.json` existieren
  auch in `en.json` (no orphans).
- Komponenten-Smoke: Render mit `en`-Locale → kein Key-String
  („pages.tasks.title") leakt ins DOM.

## Suggested Implementation

### Session 1: Foundation + Common-Keys

- `@nuxtjs/i18n` installieren, konfigurieren.
- `common.*`-Keys + globale Buttons (Speichern, Abbrechen, Löschen,
  Bearbeiten, …) extrahieren.
- Sprach-Picker bauen.
- Eine Sample-Page (z.B. `/settings/llm`) komplett umstellen.

### Session 2–N: Page-by-Page

- Pro Session 2–3 Pages extrahieren.
- Tests anpassen.
- DE + EN parallel pflegen.

### Schluss-Session: Lint + Smoke

- ESLint-Rule `nuxtjs-i18n/no-raw-text` aktivieren, alle Restlücken
  fixen.
- Manuelle Verifikation: jede Page in beiden Sprachen geöffnet.

## Open Questions

- Sollte EN am Anfang **lückenhaft** sein (fehlende Keys fallen auf
  DE zurück) oder zwingend vollständig? → Vorschlag: zwingend
  vollständig, Test enforced. Sonst leakt Deutsch in EN-UI.
- Per-Browser-Locale-Detection als initiale Auswahl? → Vorschlag: ja
  via `detectBrowserLanguage: true`, manuelle User-Wahl überschreibt.
