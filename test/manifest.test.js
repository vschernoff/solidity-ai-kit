import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import parseSpdx from 'spdx-expression-parse'
import { PACKAGE_ROOT, SCHEMA_PATH, loadManifest, readJson } from '../src/manifest.js'

const schema = readJson(SCHEMA_PATH)
const manifest = loadManifest()
// strictRequired is off because the schema's oneOf and if/then branches name fields that
// are declared once, in the component's own properties, not repeated in each branch.
const validate = new Ajv2020({
  strict: true,
  strictRequired: false,
  allErrors: true,
  allowUnionTypes: true,
}).compile(schema)

// RegExp.escape arrives in Node 24; Node 22 is supported too.
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function errorsOf(document) {
  return validate(document) ? [] : validate.errors
}

// A component that satisfies every FR-16 condition for being enabled by default. Each
// negative test below breaks exactly one of them.
function evaluatedComponent(overrides = {}) {
  return {
    id: 'example',
    stage: 'lint',
    package: 'example-mcp',
    version: '1.2.3',
    transport: 'stdio',
    license: 'MIT',
    source: 'https://example.com/example-mcp',
    evaluatedAt: '2026-10-19',
    score: 7,
    scorecardRef: 'SCORECARD.md#example',
    enabledByDefault: true,
    experimental: false,
    requiresBinaries: [],
    deniedTools: [],
    riskNotes: [],
    ...overrides,
  }
}

function manifestWith(...components) {
  return { manifestVersion: 1, components }
}

describe('kit.manifest.json (FR-14, FR-15)', () => {
  it('validates against kit.manifest.schema.json', () => {
    assert.deepEqual(errorsOf(manifest), [])
  })

  it('points editors at the schema shipped beside it', () => {
    assert.equal(path.resolve(PACKAGE_ROOT, manifest.$schema), SCHEMA_PATH)
  })

  it('has unique component ids', () => {
    const ids = manifest.components.map((component) => component.id)
    assert.deepEqual(ids, [...new Set(ids)])
  })

  it('gives every licence as a valid SPDX expression (FR-16, C7)', () => {
    for (const { id, license } of manifest.components) {
      if (license === null) continue
      assert.doesNotThrow(() => parseSpdx(license), `${id}: "${license}" is not SPDX`)
    }
  })

  it('lists every component in NOTICE with its licence and source (NFR-6)', () => {
    const notice = fs.readFileSync(path.join(PACKAGE_ROOT, 'NOTICE'), 'utf8')
    for (const component of manifest.components) {
      const name = component.package ?? component.command
      const entry = notice.match(new RegExp(`^${escapeRegExp(name)}\\n((?:  .*\\n?)+)`, 'm'))
      assert.ok(entry, `NOTICE has no entry for ${name}`)
      assert.match(
        entry[1],
        new RegExp(`Licence: ${escapeRegExp(component.license ?? 'none')}$`, 'm')
      )
      assert.match(entry[1], new RegExp(`Source: +${escapeRegExp(component.source)}$`, 'm'))
    }
  })
})

describe('schema: pinned versions (FR-4)', () => {
  it('accepts exact versions, including pre-releases', () => {
    for (const version of ['0.1.3', '10.0.0', '2.3.2-agents-preview-1', '1.0.0+build.5']) {
      assert.deepEqual(errorsOf(manifestWith(evaluatedComponent({ version }))), [], version)
    }
  })

  it('rejects ranges, tags and partial versions', () => {
    for (const version of ['^0.1.3', '~0.1.3', '>=0.1.3', '0.1', '0.1.x', '*', 'latest', '']) {
      assert.notDeepEqual(errorsOf(manifestWith(evaluatedComponent({ version }))), [], version)
    }
  })
})

describe('schema: launch method and transport', () => {
  it('requires exactly one of package or command', () => {
    const neither = evaluatedComponent()
    delete neither.package
    assert.notDeepEqual(errorsOf(manifestWith(neither)), [])
    const both = evaluatedComponent({ command: 'example' })
    assert.notDeepEqual(errorsOf(manifestWith(both)), [])
  })

  it('requires a url for the http transport', () => {
    const http = evaluatedComponent({ transport: 'http' })
    assert.notDeepEqual(errorsOf(manifestWith(http)), [])
    http.url = 'http://localhost:3000/mcp'
    assert.deepEqual(errorsOf(manifestWith(http)), [])
  })

  it('rejects fields it does not define', () => {
    const extra = evaluatedComponent({ sponsored: true })
    assert.notDeepEqual(errorsOf(manifestWith(extra)), [])
  })
})

describe('schema: who may be enabled by default (FR-16, FR-17)', () => {
  it('accepts a licensed, evaluated component with no open security finding', () => {
    const resolved = { note: 'fixed upstream', security: true, resolved: true }
    assert.deepEqual(errorsOf(manifestWith(evaluatedComponent({ riskNotes: [resolved] }))), [])
  })

  const disqualifiers = {
    'no licence': { license: null },
    'no evaluation date': { evaluatedAt: null },
    'no score': { score: null },
    'no scorecard reference': { scorecardRef: null },
    'an unresolved security finding': {
      riskNotes: [{ note: 'unbounded shell input', security: true, resolved: false }],
    },
    'experimental status': { experimental: true },
  }

  for (const [reason, overrides] of Object.entries(disqualifiers)) {
    it(`rejects enabledByDefault with ${reason}`, () => {
      assert.notDeepEqual(errorsOf(manifestWith(evaluatedComponent(overrides))), [])
    })

    it(`accepts ${reason} when the component is opt-in`, () => {
      const optIn = evaluatedComponent({ ...overrides, enabledByDefault: false })
      assert.deepEqual(errorsOf(manifestWith(optIn)), [])
    })
  }
})
