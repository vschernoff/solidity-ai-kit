import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { main } from '../src/cli.js'
import { majorOf } from '../src/hardhat-notes.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-hardhat-notes-'))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

function initIn(files, ...args) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'p'))
  fs.mkdirSync(path.join(dir, '.git'))
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content)
  }
  const before = fs.readdirSync(dir).sort()
  const out = { stdout: '', stderr: '' }
  const code = main(['init', ...args], {
    cwd: dir,
    stdout: { write: (text) => (out.stdout += text) },
    stderr: { write: (text) => (out.stderr += text) },
  })
  return { code, ...out, unchanged: fs.readdirSync(dir).sort().join() === before.join() }
}

const packageJson = (devDependencies, dependencies = {}) =>
  JSON.stringify({ name: 'p', devDependencies, dependencies })

const hardhat3 = (extra = {}) => ({
  'hardhat.config.ts': '',
  'package.json': packageJson({ hardhat: '^3.21.1', ...extra }),
})

const skillsNote = /^Note: Hardhat 3 ships agent skills for its testing workflow \(MIT\)/m
const copyLines = (stdout) => stdout.split('\n').filter((line) => line.startsWith('  mkdir -p '))

describe('the Hardhat 3 agent-skills note (D56)', () => {
  it('copies the core and viem toolbox skills into each client directory', () => {
    const result = initIn(hardhat3({ '@nomicfoundation/hardhat-toolbox-viem': '^5.0.7' }))
    assert.equal(result.code, 0)
    assert.match(result.stdout, skillsNote)
    assert.match(result.stdout, /re-copy after upgrading Hardhat/)
    const from =
      'node_modules/hardhat/skills/hardhat node_modules/hardhat/skills/hardhat-toolbox-viem'
    assert.deepEqual(copyLines(result.stdout), [
      `  mkdir -p .agents/skills && cp -R ${from} .agents/skills/`,
      `  mkdir -p .claude/skills && cp -R ${from} .claude/skills/`,
    ])
    assert.ok(result.unchanged, 'the preview writes nothing')
  })

  it('names the mocha-ethers toolbox skill, or only the core skill without a toolbox', () => {
    const mocha = initIn(
      hardhat3({ '@nomicfoundation/hardhat-toolbox-mocha-ethers': '^3.0.0' }),
      '--client',
      'codex'
    )
    assert.deepEqual(copyLines(mocha.stdout), [
      '  mkdir -p .agents/skills && cp -R node_modules/hardhat/skills/hardhat node_modules/hardhat/skills/hardhat-toolbox-mocha-ethers .agents/skills/',
    ])
    const bare = initIn(hardhat3(), '--client', 'claude-code')
    assert.deepEqual(copyLines(bare.stdout), [
      '  mkdir -p .claude/skills && cp -R node_modules/hardhat/skills/hardhat .claude/skills/',
    ])
  })

  it('reads hardhat from dependencies as well as devDependencies', () => {
    const files = {
      'hardhat.config.ts': '',
      'package.json': packageJson({}, { hardhat: '3.0.0' }),
    }
    assert.match(initIn(files).stdout, skillsNote)
  })

  it('is not printed for Hardhat 2, an unclear version, or no package.json', () => {
    for (const range of ['^2.22.0', '>=3', 'workspace:*', 'latest', '*', '2 || 3']) {
      const files = { 'hardhat.config.ts': '', 'package.json': packageJson({ hardhat: range }) }
      assert.doesNotMatch(initIn(files).stdout, skillsNote, range)
    }
    assert.doesNotMatch(initIn({ 'hardhat.config.ts': '' }).stdout, skillsNote)
    const broken = { 'hardhat.config.ts': '', 'package.json': '{ not json' }
    assert.doesNotMatch(initIn(broken).stdout, skillsNote)
  })

  it('is not printed for mixed, Foundry or unknown projects', () => {
    const pkg = { 'package.json': packageJson({ hardhat: '^3.21.1' }) }
    for (const markers of [
      { 'foundry.toml': '', 'hardhat.config.ts': '' },
      { 'foundry.toml': '' },
      {},
    ]) {
      const result = initIn({ ...markers, ...pkg })
      assert.doesNotMatch(result.stdout, skillsNote, Object.keys(markers).join() || 'none')
    }
  })
})

describe('majorOf', () => {
  it('reads the major version only from ranges that pin one', () => {
    const cases = {
      3: 3,
      '3.21.1': 3,
      '^3.21.1': 3,
      '~3': 3,
      '=3.0.0': 3,
      '3.x': 3,
      '3.0.0-next.1': 3,
      '^2.22.0': 2,
      '>=3': null,
      '3 - 4': null,
      'workspace:^3.0.0': null,
      'npm:hardhat@3': null,
      'github:NomicFoundation/hardhat': null,
    }
    for (const [range, major] of Object.entries(cases)) {
      assert.equal(majorOf(range), major, range)
    }
    assert.equal(majorOf(undefined), null)
  })
})
