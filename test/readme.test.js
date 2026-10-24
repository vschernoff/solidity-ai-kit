import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import {
  README_PATH,
  TABLE_END,
  TABLE_START,
  componentTable,
  withTable,
} from '../scripts/readme-components.js'
import { loadManifest } from '../src/manifest.js'

const manifest = loadManifest()
const readme = fs.readFileSync(README_PATH, 'utf8')

describe('README component table (FR-14)', () => {
  it('matches kit.manifest.json; run `npm run readme` after changing the manifest', () => {
    const start = readme.indexOf(TABLE_START)
    const end = readme.indexOf(TABLE_END) + TABLE_END.length
    assert.ok(start >= 0 && end > start, 'README.md has no component table markers')
    assert.equal(readme.slice(start, end), componentTable(manifest))
  })

  it('has one row per manifest component, pinned to its version', () => {
    const table = componentTable(manifest)
    const rows = table.split('\n').filter((line) => line.startsWith('| `'))
    assert.equal(rows.length, manifest.components.length)
    for (const component of manifest.components) {
      const row = rows.find((line) => line.startsWith(`| \`${component.id}\` |`))
      assert.ok(row, component.id)
      if (component.package) assert.ok(row.includes(`${component.package}@${component.version}`))
    }
  })

  it('describes default status and evaluation from the manifest, not from prose', () => {
    const base = manifest.components[0]
    const variants = [
      [
        { enabledByDefault: true, evaluatedAt: '2026-10-30' },
        /on by default \| evaluated 2026-10-30/,
      ],
      [
        { enabledByDefault: false, experimental: true },
        /opt-in, experimental \| not yet evaluated/,
      ],
    ]
    for (const [overrides, pattern] of variants) {
      const table = componentTable({ components: [{ ...base, evaluatedAt: null, ...overrides }] })
      assert.match(table, pattern)
    }
    const open = { note: 'x', security: false, resolved: false }
    const closed = { ...open, resolved: true }
    assert.match(
      componentTable({ components: [{ ...base, riskNotes: [open, closed, open] }] }),
      / \| 2 \| \[source\]/
    )
  })

  it('refuses a README without markers instead of guessing where the table goes', () => {
    assert.throws(() => withTable('# no markers\n', 'x'), /no component table markers/)
  })
})
