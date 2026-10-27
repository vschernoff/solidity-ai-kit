import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { main } from '../src/cli.js'

const tempRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-hardhat-notes-'))
)
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

// The skills Hardhat ships from 3.6.0 on, as they sit in node_modules.
const SHIPPED = ['hardhat', 'hardhat-toolbox-viem', 'hardhat-toolbox-mocha-ethers']
const skillFiles = (skills = SHIPPED) =>
  Object.fromEntries(
    skills.map((skill) => [`node_modules/hardhat/skills/${skill}/SKILL.md`, `name: ${skill}\n`])
  )

function project(files) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'p'))
  fs.mkdirSync(path.join(dir, '.git'))
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

function listing(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().join('\n')
}

function initIn(dir, ...args) {
  const before = listing(dir)
  const out = { stdout: '', stderr: '' }
  const code = main(['init', ...args], {
    cwd: dir,
    stdout: { write: (text) => (out.stdout += text) },
    stderr: { write: (text) => (out.stderr += text) },
  })
  return { code, ...out, unchanged: listing(dir) === before }
}

const packageJson = (devDependencies, dependencies = {}) =>
  JSON.stringify({ name: 'p', devDependencies, dependencies })

// A Hardhat-only project with Hardhat's skills installed.
const hardhat = (extra = {}) => ({
  'hardhat.config.ts': '',
  'package.json': packageJson({ hardhat: '^3.21.1', ...extra }),
  ...skillFiles(),
})

const skillsNote = /^Note: Hardhat 3 ships agent skills for its testing workflow \(MIT\)/m
const copyLines = (stdout) => stdout.split('\n').filter((line) => line.startsWith('  mkdir -p '))
const from = (...skills) => skills.map((skill) => `node_modules/hardhat/skills/${skill}`).join(' ')

describe('the Hardhat agent-skills note (D56)', () => {
  it('copies the core and viem toolbox skills into each client directory', () => {
    const result = initIn(project(hardhat({ '@nomicfoundation/hardhat-toolbox-viem': '^5.0.7' })))
    assert.equal(result.code, 0)
    assert.match(result.stdout, skillsNote)
    assert.match(result.stdout, /run in a POSIX shell \(and re-copy after upgrading Hardhat\)/)
    const sources = from('hardhat', 'hardhat-toolbox-viem')
    assert.deepEqual(copyLines(result.stdout), [
      `  mkdir -p .agents/skills && cp -R ${sources} .agents/skills/`,
      `  mkdir -p .claude/skills && cp -R ${sources} .claude/skills/`,
    ])
    assert.ok(result.unchanged, 'the preview writes nothing')
  })

  it('names the mocha-ethers toolbox skill, or only the core skill without a toolbox', () => {
    const mochaDependency = { '@nomicfoundation/hardhat-toolbox-mocha-ethers': '^3.0.0' }
    const mocha = initIn(project(hardhat(mochaDependency)), '--client', 'codex')
    assert.deepEqual(copyLines(mocha.stdout), [
      `  mkdir -p .agents/skills && cp -R ${from('hardhat', 'hardhat-toolbox-mocha-ethers')} .agents/skills/`,
    ])
    const bare = initIn(project(hardhat()), '--client', 'claude-code')
    assert.deepEqual(copyLines(bare.stdout), [
      `  mkdir -p .claude/skills && cp -R ${from('hardhat')} .claude/skills/`,
    ])
  })

  it('reads the toolbox from dependencies as well as devDependencies', () => {
    const files = {
      ...hardhat(),
      'package.json': packageJson({}, { '@nomicfoundation/hardhat-toolbox-viem': '^5.0.7' }),
    }
    assert.match(copyLines(initIn(project(files)).stdout)[0], /hardhat-toolbox-viem/)
  })

  it('is not printed when the installed Hardhat has no skills to copy', () => {
    const cases = {
      'not installed yet': {
        'hardhat.config.ts': '',
        'package.json': packageJson({ hardhat: '^3.0.0' }),
      },
      'Hardhat before 3.6 (no skills directory)': {
        'hardhat.config.ts': '',
        'package.json': packageJson({ hardhat: '~3.5.1' }),
        'node_modules/hardhat/package.json': '{"version":"3.5.1"}',
      },
    }
    for (const [name, files] of Object.entries(cases)) {
      assert.doesNotMatch(initIn(project(files)).stdout, skillsNote, name)
    }
  })

  it('does not follow node_modules out of the project', () => {
    const outside = project(skillFiles())
    const dir = project({
      'hardhat.config.ts': '',
      'package.json': packageJson({ hardhat: '^3.21.1' }),
    })
    // A junction on Windows needs no privilege; elsewhere the type is ignored.
    fs.symlinkSync(path.join(outside, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
    assert.doesNotMatch(initIn(dir).stdout, skillsNote)
  })

  it('is not printed for mixed, Foundry or unknown projects', () => {
    for (const markers of [
      { 'foundry.toml': '', 'hardhat.config.ts': '' },
      { 'foundry.toml': '' },
      {},
    ]) {
      const files = {
        ...markers,
        'package.json': packageJson({ hardhat: '^3.21.1' }),
        ...skillFiles(),
      }
      assert.doesNotMatch(
        initIn(project(files)).stdout,
        skillsNote,
        Object.keys(markers).join() || 'none'
      )
    }
  })
})
