import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { END, RULES_FILES, START, rulesBlock, rulesGenerator, withBlock } from '../src/rules.js'
import { runInit } from '../src/init.js'
import { loadManifest } from '../src/manifest.js'

const manifest = loadManifest()
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-rules-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

const ALL_CLIENTS = Object.keys(RULES_FILES)
const foundry = { kind: 'foundry' }

// Stand-ins for stages the real manifest does not cover yet.
const fuzzer = { id: 'fuzzer', stage: 'fuzz', experimental: true, deniedTools: [] }
const linter = { id: 'linter', stage: 'lint', experimental: false, deniedTools: [] }

let counter = 0
function project(files = {}) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'foundry.toml'), '')
  for (const [file, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, file), content)
  return dir
}

function sink() {
  let text = ''
  return {
    write: (chunk) => {
      text += chunk
    },
    get text() {
      return text
    },
  }
}

function init(dir, { components = manifest.components, clients = ALL_CLIENTS } = {}) {
  return runInit({
    root: dir,
    write: true,
    components,
    generators: [rulesGenerator(clients)],
    stdout: sink(),
    stderr: sink(),
  })
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8')
const text = (components, project = foundry) => rulesBlock(project, components).join('\n')

describe('workflow rules text (FR-18…FR-23)', () => {
  const all = text([...manifest.components, linter, fuzzer])

  it('gives the order build/test → fix → lint → fix → repeat, and fuzzing (FR-18)', () => {
    const build = all.indexOf('build and run the relevant tests')
    const lint = all.indexOf('Then lint')
    const repeat = all.indexOf('Repeat until')
    assert.ok(build >= 0 && build < lint && lint < repeat)
    assert.match(all, /fuzz or invariant tests; run them with the `fuzzer` MCP server/)
  })

  it('forbids weakening checks unless the user agrees (FR-19)', () => {
    for (const phrase of [
      'switch lint rules off',
      'skipped or deleted tests',
      'lowered fuzz runs',
      'loosened configs',
      'unless the user agrees',
    ]) {
      assert.ok(all.includes(phrase), phrase)
    }
  })

  it('caps iteration at 5 rounds and asks for what remains (FR-20)', () => {
    assert.match(all, /Stop after 5 rounds and report what remains/)
  })

  it('says tests and lint are not a security proof, recommends an audit, names no firm (FR-21)', () => {
    assert.match(all, /do not prove a contract is secure/)
    assert.match(all, /independent audit/)
    assert.doesNotMatch(
      all,
      /OpenZeppelin|Trail of Bits|ConsenSys|Certora|Spearbit|Cantina|Code4rena|Sherlock/
    )
  })

  it('forbids transactions, deploys and private keys (FR-22)', () => {
    assert.match(all, /Never send transactions, deploy, or handle private keys/)
  })

  it('names only installed components (FR-23)', () => {
    const none = text([])
    assert.match(none, /Tools installed by solidity-ai-kit: none\./)
    assert.doesNotMatch(none, /Then lint|MCP server/)
    for (const component of manifest.components) {
      assert.doesNotMatch(none, new RegExp(`\\b${component.id}\\b`), component.id)
      const only = text([component])
      assert.match(only, new RegExp(`\`${component.id}\``))
      for (const other of manifest.components.filter((c) => c.id !== component.id)) {
        assert.doesNotMatch(only, new RegExp(`\\b${other.id}\\b`), other.id)
      }
    }
    assert.doesNotMatch(text([linter]), /run them with/)
  })

  it('labels experimental components', () => {
    assert.match(text([fuzzer]), /`fuzzer \(experimental\)` \(fuzz\)/)
  })

  it('uses the project’s own build commands', () => {
    assert.match(text([], { kind: 'foundry' }), /`forge build` and `forge test`/)
    assert.match(text([], { kind: 'hardhat' }), /`npx hardhat compile` and `npx hardhat test`/)
    assert.match(text([], { kind: 'both' }), /forge test.*npx hardhat test/)
    assert.match(text([], { kind: 'none' }), /the project's build and test commands/)
  })

  it('stays client-neutral and within 25 lines', () => {
    for (const components of [[], manifest.components, [linter, fuzzer]]) {
      const block = rulesBlock(foundry, components)
      assert.ok(block.length <= 25, `${block.length} lines`)
      assert.doesNotMatch(block.join('\n'), /Claude|Codex|Cursor/)
    }
  })
})

describe('the delimited block in AGENTS.md and CLAUDE.md (FR-6)', () => {
  it('creates both files by default, each holding exactly one block', () => {
    const dir = project()
    init(dir)
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const content = read(dir, file)
      assert.equal(content.split(START).length - 1, 1, file)
      assert.equal(content.split(END).length - 1, 1, file)
    }
  })

  it('writes only the file each selected client reads', () => {
    const claudeOnly = project()
    init(claudeOnly, { clients: ['claude-code'] })
    assert.ok(fs.existsSync(path.join(claudeOnly, 'CLAUDE.md')))
    assert.ok(!fs.existsSync(path.join(claudeOnly, 'AGENTS.md')))

    const cursorOnly = project()
    init(cursorOnly, { clients: ['cursor', 'codex'] })
    assert.ok(fs.existsSync(path.join(cursorOnly, 'AGENTS.md')))
    assert.ok(!fs.existsSync(path.join(cursorOnly, 'CLAUDE.md')))
  })

  it('is idempotent: two runs leave identical files', () => {
    const dir = project({ 'AGENTS.md': '# Notes\n' })
    init(dir)
    const first = { agents: read(dir, 'AGENTS.md'), claude: read(dir, 'CLAUDE.md') }
    init(dir)
    assert.deepEqual({ agents: read(dir, 'AGENTS.md'), claude: read(dir, 'CLAUDE.md') }, first)
  })

  it('replaces only the block; text before and after it is untouched', () => {
    const before = '# Project\n\nKeep this.\n\n'
    const afterText = '\n## Later section\n\nAnd this.\n'
    const dir = project({ 'AGENTS.md': `${before}${START}\nold rules\n${END}${afterText}` })
    init(dir, { components: [] })
    const content = read(dir, 'AGENTS.md')
    assert.ok(content.startsWith(before))
    assert.ok(content.endsWith(`${END}${afterText}`))
    assert.doesNotMatch(content, /old rules/)
  })

  it('updates the block when the installed components change', () => {
    const dir = project()
    init(dir, { components: [] })
    assert.match(read(dir, 'AGENTS.md'), /installed by solidity-ai-kit: none/)
    init(dir)
    for (const component of manifest.components) {
      assert.match(read(dir, 'AGENTS.md'), new RegExp(`\`${component.id}\``))
    }
  })

  it('keeps CRLF line endings', () => {
    const dir = project({ 'AGENTS.md': '# Notes\r\n' })
    init(dir)
    const content = read(dir, 'AGENTS.md')
    assert.ok(content.includes(`${START}\r\n`))
    assert.ok(!/[^\r]\n/.test(content))
  })

  for (const [name, broken] of Object.entries({
    'a start marker only': `${START}\nrules\n`,
    'an end marker only': `rules\n${END}\n`,
    'markers out of order': `${END}\n${START}\n`,
    'two blocks': `${START}\n${END}\n${START}\n${END}\n`,
  })) {
    it(`refuses a file with ${name}, and writes nothing`, () => {
      const dir = project({ 'AGENTS.md': broken })
      assert.throws(() => init(dir), /damaged solidity-ai-kit block/)
      assert.equal(read(dir, 'AGENTS.md'), broken)
      assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')))
    })
  }

  it('withBlock leaves an empty or missing file holding just the block', () => {
    const block = [START, 'x', END]
    assert.equal(withBlock('A.md', null, block), `${START}\nx\n${END}\n`)
    assert.equal(withBlock('A.md', '', block), `${START}\nx\n${END}\n`)
  })
})
