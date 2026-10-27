import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { main } from '../src/cli.js'
import { isDefaultFor, selectComponents } from '../src/components.js'
import { loadManifest } from '../src/manifest.js'

const KINDS = ['foundry', 'hardhat', 'both', 'none']

function component(id, overrides = {}) {
  return { id, enabledByDefault: true, ...overrides }
}

const ids = (components) => components.map(({ id }) => id)

describe('which components init selects (defaultFor)', () => {
  const foundryOnly = component('forge-only', { defaultFor: ['foundry', 'both'] })
  const everywhere = component('everywhere')
  const optIn = component('opt-in', { enabledByDefault: false })
  const manifest = { components: [foundryOnly, everywhere, optIn] }

  it('selects a component limited to Foundry in foundry and both projects only', () => {
    const selected = Object.fromEntries(
      KINDS.map((kind) => [kind, ids(selectComponents(manifest, [], { kind }))])
    )
    assert.deepEqual(selected, {
      foundry: ['forge-only', 'everywhere'],
      hardhat: ['everywhere'],
      both: ['forge-only', 'everywhere'],
      none: ['everywhere'],
    })
  })

  it('still selects it anywhere when asked for with --with', () => {
    for (const kind of KINDS) {
      assert.deepEqual(ids(selectComponents(manifest, ['forge-only', 'opt-in'], { kind })), [
        'forge-only',
        'everywhere',
        'opt-in',
      ])
    }
  })

  it('never turns on a component that is not enabled by default', () => {
    const limitedOptIn = component('x', { enabledByDefault: false, defaultFor: ['foundry'] })
    assert.equal(isDefaultFor(limitedOptIn, { kind: 'foundry' }), false)
  })

  it('keeps every unrestricted default on in every kind of project, as before', () => {
    const real = loadManifest()
    const unrestricted = real.components.filter(
      (c) => c.enabledByDefault && c.defaultFor === undefined
    )
    for (const kind of KINDS) {
      const selected = ids(selectComponents(real, [], { kind }))
      for (const { id } of unrestricted) assert.ok(selected.includes(id), `${id} in ${kind}`)
    }
  })

  it('treats a missing project as one of no known kind', () => {
    assert.deepEqual(ids(selectComponents(manifest)), ['everywhere'])
  })

  it('rejects an unknown --with id whatever the project', () => {
    assert.throws(
      () => selectComponents(manifest, ['nope'], { kind: 'foundry' }),
      /Unknown component: nope/
    )
  })
})

describe('init chooses defaults for the project it runs in', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-components-test-'))
  after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  // A real manifest component, renamed and limited to Foundry projects.
  const [base] = loadManifest().components
  const foundryOnly = { ...base, id: 'foundry-only', defaultFor: ['foundry', 'both'] }
  const manifest = { manifestVersion: 1, components: [foundryOnly] }

  function initIn(marker, ...args) {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'p'))
    fs.mkdirSync(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, marker), '')
    const out = { stdout: '', stderr: '' }
    const code = main(['init', ...args], {
      cwd: dir,
      manifest,
      stdout: { write: (text) => (out.stdout += text) },
      stderr: { write: (text) => (out.stderr += text) },
    })
    return { code, ...out }
  }

  it('includes it in a Foundry project', () => {
    const result = initIn('foundry.toml')
    assert.equal(result.code, 0)
    assert.match(result.stdout, /^Components: foundry-only$/m)
  })

  it('leaves it out of a Hardhat project unless asked for', () => {
    const result = initIn('hardhat.config.ts')
    assert.equal(result.code, 0)
    assert.match(result.stderr, /No components are enabled by default for this project/)
    assert.doesNotMatch(result.stdout, /foundry-only/)
    const asked = initIn('hardhat.config.ts', '--with', 'foundry-only')
    assert.match(asked.stdout, /^Components: foundry-only$/m)
  })
})
