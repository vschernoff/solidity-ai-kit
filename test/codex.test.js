import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { parse } from 'smol-toml'
import { CONFIG_FILE, codex } from '../src/clients/codex.js'
import { runInit } from '../src/init.js'
import { loadManifest } from '../src/manifest.js'

const manifest = loadManifest()
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-codex-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

// The real components, all opted in; and one that signs, to exercise FR-7.
const components = manifest.components
const [first] = components
const signer = {
  id: 'signer',
  package: 'signer-mcp',
  version: '1.0.0',
  transport: 'stdio',
  deniedTools: ['send_transaction', 'sign_message'],
  denyFallback: 'exclude',
  experimental: false,
}

let counter = 0
function project(config) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'foundry.toml'), '')
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.codex'))
    fs.writeFileSync(path.join(dir, CONFIG_FILE), config)
  }
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

function run(dir, selected = components) {
  const stdout = sink()
  const stderr = sink()
  let code
  let error
  try {
    code = runInit({
      root: dir,
      write: true,
      components: selected,
      generators: [codex],
      stdout,
      stderr,
    })
  } catch (thrown) {
    error = thrown
  }
  const file = path.join(dir, CONFIG_FILE)
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  return { code, error, stdout: stdout.text, text }
}

describe('Codex .codex/config.toml (FR-3, FR-4, FR-7)', () => {
  it('creates a project config that parses as TOML, pinned to manifest versions', () => {
    const { text, stdout } = run(project())
    const servers = parse(text).mcp_servers
    for (const component of components.filter((c) => c.package)) {
      assert.equal(servers[component.id].command, 'npx')
      assert.deepEqual(servers[component.id].args, [
        '-y',
        `${component.package}@${component.version}`,
      ])
    }
    assert.doesNotMatch(text, /@latest|@\^|@~/)
    assert.match(stdout, /Codex reads \.codex\/config\.toml only when you trust this project/)
  })

  it('denies listed tools with disabled_tools, keeping the user’s own entries once', () => {
    const dir = project(
      '[mcp_servers.signer]\ncommand = "old"\ndisabled_tools = ["drain", "sign_message"]\n'
    )
    const servers = parse(run(dir, [signer]).text).mcp_servers
    assert.deepEqual(servers.signer.disabled_tools, ['drain', 'sign_message', 'send_transaction'])
    assert.deepEqual(servers.signer.args, ['-y', 'signer-mcp@1.0.0'])
  })

  it('is idempotent', () => {
    const dir = project()
    const firstRun = run(dir)
    const second = sink()
    runInit({
      root: dir,
      write: true,
      components,
      generators: [codex],
      stdout: second,
      stderr: sink(),
    })
    assert.match(second.text, /Nothing to change/)
    assert.equal(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'), firstRun.text)
  })
})

describe('Codex merge keeps the user’s file (FR-5)', () => {
  const handWritten = [
    '# my codex project config',
    'model = "gpt-x"',
    '',
    '# hand-written, from a README',
    `[mcp_servers.${first.id}]`,
    'command = "npx"',
    `args = ["-y", "${first.package ?? 'x'}"]`,
    '',
    `[mcp_servers.${first.id}.env]`,
    'DEBUG = "1"',
    '',
    '# another server I use',
    '[mcp_servers.other]',
    'command = "other"',
    '',
  ].join('\n')

  it('rewrites only the kit’s own table; comments, other keys and tables stay', () => {
    const { text, error } = run(project(handWritten))
    // The write must have happened: an untouched file would pass the checks below too.
    assert.equal(error, undefined)
    const config = parse(text)
    assert.deepEqual(config.mcp_servers[first.id].args, ['-y', `${first.package}@${first.version}`])
    // The env sub-table was the kit's to rewrite, so exactly one copy remains.
    assert.equal(text.split(`[mcp_servers.${first.id}.env]`).length - 1, 1)
    assert.equal(config.model, 'gpt-x')
    assert.deepEqual({ ...config.mcp_servers.other }, { command: 'other' })
    assert.deepEqual({ ...config.mcp_servers[first.id].env }, { DEBUG: '1' })
    for (const comment of [
      '# my codex project config',
      '# hand-written, from a README',
      '# another server I use',
    ]) {
      assert.ok(text.includes(comment), comment)
    }
    // The kit's table stays where the user put it, before the other server.
    assert.ok(text.indexOf(`[mcp_servers.${first.id}]`) < text.indexOf('[mcp_servers.other]'))
  })

  it('replaces a quoted table name instead of adding a duplicate', () => {
    const { text, error } = run(project(`[mcp_servers."${first.id}"]\ncommand = "x"\n`))
    assert.equal(error, undefined)
    assert.equal(parse(text).mcp_servers[first.id].command, 'npx')
    assert.ok(!text.includes(`"${first.id}"]`))
  })

  it('keeps CRLF line endings', () => {
    const { text } = run(project('model = "gpt-x"\r\n'))
    assert.ok(text.includes('\r\n'))
    assert.ok(!/[^\r]\n/.test(text))
  })

  const unsafe = {
    'an inline table': `mcp_servers = { ${first.id} = { command = "x" } }\n`,
    'dotted keys': `[mcp_servers]\n${first.id}.command = "x"\n`,
    'invalid TOML': '[mcp_servers\n',
    'mcp_servers that is not a table': 'mcp_servers = 3\n',
  }
  for (const [name, config] of Object.entries(unsafe)) {
    it(`stops without writing when the file has ${name}`, () => {
      const { error, text } = run(project(config))
      assert.ok(error, name)
      assert.match(error.message, /config\.toml/)
      assert.equal(text, config)
    })
  }

  it('shows the exact table to paste when it cannot edit safely', () => {
    const { error } = run(project(unsafe['an inline table']))
    assert.match(error.message, new RegExp(`\\[mcp_servers\\.${first.id}\\]`))
  })

  it('never quotes file contents when the TOML is invalid', () => {
    const { error } = run(project('token = "s3cr3t-value"\nbad = [\n'))
    assert.match(error.message, /not valid TOML \(line \d+, column \d+\)/)
    assert.doesNotMatch(error.message, /s3cr3t|token/)
  })

  it('writes no env values or credentials of its own (FR-8)', () => {
    const { text } = run(project())
    assert.doesNotMatch(text, /env|0x[0-9a-fA-F]{64}|PRIVATE|SECRET|TOKEN|API_KEY|:\/\/[^/\s"]+@/i)
  })
})
