# Plan 29-D: LLM-Credential und Modell pro Persona

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Cross-repo. Persona-Tabelle bekommt zwei neue Spalten, Resolver liefert
zusätzlich zur System-Prompt-Composition auch das gewählte LLM, Frontend
bekommt zwei Dropdowns pro Persona-Card.

Depends on: [29-A](./29a-personas-and-channels.md) (Personas-Tabelle),
bestehende `llm_credentials`-Infrastruktur (provider_models, list_provider_models).

## Goal

Pro Persona unabhängig wählen, **welche LLM-Credential** und **welches
Modell** sie nutzt. Bewusst entkoppelt: eine Credential bringt Zugang zu
**allen** Modellen ihres Providers; die Persona entscheidet, welches
Modell aus diesem Pool aktiv ist.

Beispiel: Credential „Anthropic-Personal" → Persona „Code-Reviewer"
nutzt `claude-opus-4-7`, Persona „Tutor" nutzt `claude-sonnet-4-6`.

## Why

Stärkere Modelle sind teurer und langsamer. Eine Persona, die nur
Brainstorming macht, braucht kein Opus. Eine, die Code reviewen soll,
braucht es schon.

Heute (Plan 09 ff.) hat jede `LlmCredential` ein `model`-Feld — das
funktioniert nur, weil aktuell eine Credential = der gesamte Agent
ist. Mit Personas zerbricht die Annahme.

## Non-Goals

- **Reasoning-Stufe pro Persona** (Plan 23 Composer-Chips). Kann
  Follow-up sein.
- **Auto-Selection / Cost-aware Routing.** Persona wählt manuell.
- **Per-Persona-Provider-Settings** (Temperatur, Top-P, etc.). Folgt
  später, wenn nachgefragt.
- **Fallback-Cascading** (Opus → wenn down → Sonnet). YAGNI.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- Migration `personas`:
  - Neue Spalte `llm_credential_id INTEGER REFERENCES llm_credentials(id)
    ON DELETE SET NULL`.
  - Neue Spalte `model TEXT` (nullable, ein String wie
    `"claude-opus-4-7"`).
- `LlmCredential.model` wird zu **Default-Modell der Credential** (für
  legacy Code-Pfade) — das Feld bleibt, aber Personas überschreiben es.

**Resolver-Erweiterung:** statt nur einen System-Prompt-String liefert
der Resolver einen `PersonaContext`:

```python
@dataclass
class PersonaContext:
    system_prompt: str           # persona.prompt + "\n\n" + channel.prompt
    credential: LlmCredential    # immer non-null; Fallback auf is_active
    model: str                   # persona.model OR credential.model

async def resolve_persona_context(
    channel: str,
    db,
    *,
    persona_id_override: int | None = None,
) -> PersonaContext: ...
```

Resolution:
1. Persona-ID: override → channel.default_persona_id → globale Default-
   Persona.
2. Credential: persona.llm_credential_id → falls None → is_active-Credential.
3. Modell: persona.model → falls None → credential.model.
4. Wenn keine Credential gefunden (frische Installation) → wirf
   `NoCredentialError(503)`.

**Endpoints:**

- `PUT /api/personas/{id}` akzeptiert zusätzlich `llm_credential_id` und
  `model`. Validierung:
  - `llm_credential_id` muss existieren (oder `null`) → sonst 422.
  - `model` muss in `list_provider_models(credential)` enthalten sein
    (case-sensitive ID-Match) → sonst 422. Wenn `llm_credential_id`
    null, dann auch `model` null erzwingen.
- Neuer Helper-Endpoint **`GET /api/personas/{id}/models`** → ruft
  intern `list_provider_models(persona.credential)` auf, sodass das
  Frontend ein Dropdown füllen kann, ohne den Credential-API direkt
  zu kennen.

**Call-Sites-Umstellung:** alle `run_agent(...)` werden umgestellt von
„nimm is_active-Credential" auf „nimm `PersonaContext.credential`".

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api`.
- `usePersonas.ts` bekommt `listModels(personaId)`.
- Persona-Card aus 29-A erweitern:
  - **Credential-Dropdown** — listet alle Credentials aus
    `GET /api/llm/credentials`. „— (globale Default-Credential) —" als
    erste Option.
  - **Modell-Dropdown** — lädt nach Credential-Wahl `GET
    /api/personas/{id}/models` (oder Frontend ruft direkt
    `/api/llm/credentials/{id}/models` aus existierender Infrastruktur);
    Default = Credential's Default-Modell.
- Wenn keine Credential gewählt → Modell-Dropdown disabled mit Hint
  „verwendet das Modell der aktiven Credential".

### Tests

Backend:
- `tests/test_personas_resolver.py` erweitert: `PersonaContext` ist
  korrekt geresolved in 6 Pfaden (Persona × Credential × Modell jeweils
  set/unset).
- `tests/test_api_preferences.py`: PUT mit unbekannter Credential →
  422; PUT mit Modell, das im Provider-Modell-Listing fehlt → 422.
- `tests/test_chat.py` (oder `test_runner.py`): Persona mit eigener
  Credential → Upstream-Mock wird mit deren ciphertext aufgerufen.

Frontend:
- `tests/components/PreferencesPage.test.ts`: Credential-Switch lädt
  Modell-Liste neu; Modell-Wahl persistiert; Reset („globale Default")
  setzt beide auf null.

## Open Questions

- Soll der Modell-Dropdown sortiert sein (z.B. Opus oben, dann Sonnet,
  dann Haiku) oder alphabetisch? → Vorschlag: Backend-`list_provider_
  models` definiert die Reihenfolge (heute schon der Fall in
  `ANTHROPIC_OAUTH_MODELS`).
- Wenn `llm_credential_id` per `ON DELETE SET NULL` aufgeräumt wird,
  muss `model` synchron auf NULL gesetzt werden? → **Ja**, sonst hat
  Persona ein Modell ohne Credential-Provider — Migrations-Trigger
  oder app-seitiger Cleanup im Credential-Delete-Endpoint.
