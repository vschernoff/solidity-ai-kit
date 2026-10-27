import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { main } from '../src/cli.js'
import { copyCommand } from '../src/hardhat-notes.js'

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
const copyLines = (stdout) =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('  node -e '))
    .map((line) => line.trim())

describe('the Hardhat agent-skills note (D56)', () => {
  it('copies the core and viem toolbox skills into each client directory', () => {
    const result = initIn(project(hardhat({ '@nomicfoundation/hardhat-toolbox-viem': '^5.0.7' })))
    assert.equal(result.code, 0)
    assert.match(result.stdout, skillsNote)
    assert.match(result.stdout, /to use them, run \(and re-copy after upgrading Hardhat\)/)
    const skills = ['hardhat', 'hardhat-toolbox-viem']
    assert.deepEqual(copyLines(result.stdout), [
      copyCommand(skills, '.agents/skills'),
      copyCommand(skills, '.claude/skills'),
    ])
    assert.ok(result.unchanged, 'the preview writes nothing')
  })

  it('names the mocha-ethers toolbox skill, or only the core skill without a toolbox', () => {
    const mochaDependency = { '@nomicfoundation/hardhat-toolbox-mocha-ethers': '^3.0.0' }
    const mocha = initIn(project(hardhat(mochaDependency)), '--client', 'codex')
    assert.deepEqual(copyLines(mocha.stdout), [
      copyCommand(['hardhat', 'hardhat-toolbox-mocha-ethers'], '.agents/skills'),
    ])
    const bare = initIn(project(hardhat()), '--client', 'claude-code')
    assert.deepEqual(copyLines(bare.stdout), [copyCommand(['hardhat'], '.claude/skills')])
  })

  it("prints commands that copy the skills when run by this platform's shell", () => {
    const dir = project(hardhat({ '@nomicfoundation/hardhat-toolbox-viem': '^5.0.7' }))
    fs.writeFileSync(path.join(dir, 'node_modules/hardhat/skills/hardhat/extra.md'), 'x\n')
    const lines = copyLines(initIn(dir).stdout)
    assert.equal(lines.length, 2)
    // execSync runs each line the way a user would paste it: /bin/sh, or cmd.exe on Windows.
    for (const line of lines) execSync(line, { cwd: dir, stdio: 'pipe' })
    for (const target of ['.agents/skills', '.claude/skills']) {
      for (const file of [
        'hardhat/SKILL.md',
        'hardhat/extra.md',
        'hardhat-toolbox-viem/SKILL.md',
      ]) {
        assert.ok(fs.existsSync(path.join(dir, target, file)), `${target}/${file}`)
      }
      assert.ok(!fs.existsSync(path.join(dir, target, 'hardhat-toolbox-mocha-ethers')))
    }
    // Running it again after an upgrade overwrites the copies.
    fs.writeFileSync(path.join(dir, 'node_modules/hardhat/skills/hardhat/SKILL.md'), 'v2\n')
    execSync(lines[0], { cwd: dir, stdio: 'pipe' })
    assert.equal(fs.readFileSync(path.join(dir, '.agents/skills/hardhat/SKILL.md'), 'utf8'), 'v2\n')
  })

  it('uses no character bash, zsh, PowerShell or cmd would expand inside double quotes', () => {
    const command = copyCommand(['hardhat', 'hardhat-toolbox-mocha-ethers'], '.agents/skills')
    const quoted = command.slice('node -e "'.length, -1)
    assert.ok(command.startsWith('node -e "') && command.endsWith('"'))
    assert.doesNotMatch(quoted, /["$!%`\\]/)
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
