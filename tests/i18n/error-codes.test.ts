import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Plan 30 Task 3 — pin the FE↔BE error-code coverage.
//
// The backend's `hermes.errors.ErrorCode` enum is the contract. Every
// value must be renderable on the FE as `errors.<VALUE>` in both locales,
// otherwise an HTTP error from the backend would surface as a fallback
// "Unknown error (CODE)" until someone notices the missing translation.
//
// We parse the enum directly from the backend source instead of going
// through the OpenAPI schema: the codes only appear in OpenAPI as
// free-form `detail` strings in examples, not as a typed schema, so the
// generated `app/types/api.ts` doesn't carry them. Reading the .py file
// keeps the FE test independent of `pnpm run gen:api` having been run.

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '../..')
const BACKEND_ENUM_PATH = resolve(
  REPO_ROOT,
  '../Holzi/src/hermes/errors.py',
)

function readErrorCodes(): string[] {
  const src = readFileSync(BACKEND_ENUM_PATH, 'utf8')
  // Match `    NAME = "VALUE"` rows; the enum file uses the StrEnum
  // convention where name == value, but we read the value side so a
  // typo on either side would surface here as a missing locale key.
  const codes: string[] = []
  const memberRe = /^ {4}([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z0-9_]+)"/gm
  let m: RegExpExecArray | null
  while ((m = memberRe.exec(src)) !== null) {
    codes.push(m[2])
  }
  return codes
}

const localesDir = resolve(REPO_ROOT, 'i18n/locales')
const de = JSON.parse(readFileSync(resolve(localesDir, 'de.json'), 'utf8'))
const en = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8'))

const codes = readErrorCodes()

describe('errors.<ErrorCode> i18n coverage', () => {
  it('parses at least the baseline codes from hermes.errors.ErrorCode', () => {
    expect(codes.length).toBeGreaterThan(30)
    // Spot-check a few well-known anchors so a corrupt parse can't pass.
    expect(codes).toContain('CONVERSATION_NOT_FOUND')
    expect(codes).toContain('WORKSPACE_GIT_COMMAND_FAILED')
    expect(codes).toContain('DIAG_SANDBOX_CONFIGURED')
  })

  for (const code of codes) {
    it(`de + en provide errors.${code}`, () => {
      expect(de.errors?.[code], `de.errors.${code}`).toBeTypeOf('string')
      expect(en.errors?.[code], `en.errors.${code}`).toBeTypeOf('string')
      // Empty strings would render as blank cards — defend against a copy
      // accident where the row was added but the value was left empty.
      expect((de.errors?.[code] as string).length).toBeGreaterThan(0)
      expect((en.errors?.[code] as string).length).toBeGreaterThan(0)
    })
  }
})
