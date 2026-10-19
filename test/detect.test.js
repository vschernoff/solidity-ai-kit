import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { FOUNDRY_MARKERS, HARDHAT_MARKERS, detectProject } from '../src/detect.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-detect-'))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

let counter = 0
// Every fixture is its own git repository, so the parent-project search stops at the
// fixture and never wanders into whatever happens to sit above the temp directory.
function fixture(files = [], { git = true } = {}) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(dir)
  if (git) fs.mkdirSync(path.join(dir, '.git'))
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), '')
  }
  return dir
}

describe('detectProject (FR-1)', () => {
  const cases = {
    foundry: ['foundry.toml', 'src/Counter.sol'],
    hardhat: ['hardhat.config.ts', 'contracts/Counter.sol'],
    both: ['foundry.toml', 'hardhat.config.js'],
    none: ['contracts/Counter.sol', 'package.json'],
  }

  for (const [kind, files] of Object.entries(cases)) {
    it(`detects a ${kind} project`, () => {
      const dir = fixture(files)
      const result = detectProject(dir)
      assert.equal(result.kind, kind)
      assert.equal(result.root, dir)
      assert.equal(result.foundry, kind === 'foundry' || kind === 'both')
      assert.equal(result.hardhat, kind === 'hardhat' || kind === 'both')
      assert.deepEqual(
        result.markers,
        files.filter((file) => [...FOUNDRY_MARKERS, ...HARDHAT_MARKERS].includes(file))
      )
      assert.equal(result.parentProject, null)
    })
  }

  for (const marker of HARDHAT_MARKERS) {
    it(`recognises ${marker}`, () => {
      assert.equal(detectProject(fixture([marker])).kind, 'hardhat')
    })
  }

  it('ignores config names neither Hardhat version loads', () => {
    for (const name of ['hardhat.config.mjs', 'hardhat.config.mts', 'hardhat.config.json']) {
      assert.equal(detectProject(fixture([name])).kind, 'none', name)
    }
  })

  it('does not count a directory named like a marker', () => {
    const dir = fixture()
    fs.mkdirSync(path.join(dir, 'foundry.toml'))
    assert.equal(detectProject(dir).kind, 'none')
  })

  it('resolves a relative path to an absolute root', () => {
    const dir = fixture(['foundry.toml'])
    const relative = path.relative(process.cwd(), dir)
    assert.equal(detectProject(relative).root, dir)
  })

  it('names the parent project when run from a subdirectory', () => {
    const dir = fixture(['foundry.toml', 'src/nested/A.sol'])
    const result = detectProject(path.join(dir, 'src', 'nested'))
    assert.equal(result.kind, 'none')
    assert.equal(result.parentProject, dir)
  })

  it('does not look for a parent project past the git root', () => {
    const outer = fixture(['foundry.toml'], { git: false })
    const inner = path.join(outer, 'packages', 'app')
    fs.mkdirSync(path.join(inner, '.git'), { recursive: true })
    const result = detectProject(path.join(inner))
    assert.equal(result.kind, 'none')
    assert.equal(result.parentProject, null)
  })
})
