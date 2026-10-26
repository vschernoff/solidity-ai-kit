import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadManifest } from '../../src/manifest.js'
import { EVAL_ROOT } from '../lib/fixtures.js'

const SCORECARD = path.join(EVAL_ROOT, '..', 'SCORECARD.md')
const text = fs.readFileSync(SCORECARD, 'utf8')
const headings = text.split('\n').filter((line) => /^#{2,4} /.test(line))

describe('SCORECARD.md', () => {
  it('has every section a manifest scorecardRef points to (FR-14, NFR-7)', () => {
    for (const component of loadManifest().components) {
      if (!component.scorecardRef) continue
      const sections = [...component.scorecardRef.matchAll(/§\s*([0-9]+(?:\.[0-9]+[a-z]?)?)/g)]
      assert.ok(sections.length > 0, `${component.id}: scorecardRef names no section`)
      for (const [, section] of sections) {
        const pattern = new RegExp(`^#{2,4} ${section.replace('.', '\\.')}[ .]`)
        assert.ok(
          headings.some((h) => pattern.test(h)),
          `${component.id}: no heading for §${section}`
        )
      }
    }
  })

  it('names every manifest component at its pinned version in the decisions', () => {
    for (const component of loadManifest().components) {
      assert.ok(
        text.includes(`\`${component.package}\` ${component.version}`),
        `${component.package} ${component.version} missing`
      )
    }
  })

  it('names no source location (file:line) for any candidate', () => {
    assert.doesNotMatch(text, /\b[\w./-]+\.(?:ts|js|mjs|hs|py):\d+/)
  })

  it('makes no safety claim', () => {
    assert.match(text, /Nothing here says a contract is secure/)
    assert.doesNotMatch(
      text,
      /\b(?:guarantees?|ensures?) (?:the )?(?:contract|code) is (?:safe|secure)/i
    )
  })
})
