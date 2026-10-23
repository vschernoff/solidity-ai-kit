import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { claudeCode, MCP_FILE, SETTINGS_FILE } from '../src/clients/claude-code.js'
import { cursor, MCP_FILE as CURSOR_FILE } from '../src/clients/cursor.js'
import { label } from '../src/components.js'
import { runInit } from '../src/init.js'
import { PACKAGE_ROOT, loadManifest, readPackageJson } from '../src/manifest.js'

const manifest = loadManifest()
const packageJson = readPackageJson()
const bin = path.join(PACKAGE_ROOT, packageJson.bin[packageJson.name])
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-clients-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

// The opt-in components a user can name with --with; tests never hard-code which.
const allIds = manifest.components.map(({ id }) => id)
const withAll = allIds.flatMap((id) => ['--with', id])

let counter = 0
function project(files = {}) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'foundry.toml'), '[profile.default]\n')
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

const readJson = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const exists = (dir, file) => fs.existsSync(path.join(dir, file))

function hashTree(dir) {
  const hash = crypto.createHash('sha256')
  for (const entry of fs.readdirSync(dir, { recursive: true }).sort()) {
    hash.update(`${entry}\0`)
    const full = path.join(dir, entry)
    if (fs.statSync(full).isFile()) hash.update(fs.readFileSync(full))
  }
  return hash.digest('hex')
}

async function cli(cwd, ...args) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [bin, ...args], { cwd })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
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

// A component that signs, to exercise FR-7 without one in the real manifest.
function signer(denyFallback) {
  return {
    id: 'signer',
    stage: 'utilities',
    package: 'signer-mcp',
    version: '1.0.0',
    transport: 'stdio',
    deniedTools: ['send_transaction', 'sign_message'],
    denyFallback,
    experimental: false,
  }
}

describe('client configs from the real manifest (FR-3, FR-4)', () => {
  it('writes project-scoped configs for every client by default, parseable as JSON', async () => {
    const dir = project()
    const result = await cli(dir, 'init', '--write', ...withAll)
    assert.equal(result.code, 0, result.stderr)
    for (const file of [MCP_FILE, CURSOR_FILE]) {
      const servers = readJson(dir, file).mcpServers
      assert.deepEqual(Object.keys(servers).sort(), [...allIds].sort(), file)
    }
  })

  it('pins every npm component to its exact manifest version', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    for (const file of [MCP_FILE, CURSOR_FILE]) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      assert.doesNotMatch(text, /@latest|@\^|@~|@[<>=*]/, file)
      const servers = readJson(dir, file).mcpServers
      for (const component of manifest.components.filter((c) => c.package)) {
        assert.deepEqual(
          servers[component.id].args.slice(0, 2),
          ['-y', `${component.package}@${component.version}`],
          `${file}: ${component.id}`
        )
      }
    }
  })

  it('writes only the clients asked for', async () => {
    const claudeOnly = project()
    await cli(claudeOnly, 'init', '--write', '--client', 'claude-code', ...withAll)
    assert.ok(exists(claudeOnly, MCP_FILE))
    assert.ok(!exists(claudeOnly, CURSOR_FILE))

    const cursorOnly = project()
    await cli(cursorOnly, 'init', '--write', '--client=cursor', ...withAll)
    assert.ok(!exists(cursorOnly, MCP_FILE))
    assert.ok(exists(cursorOnly, CURSOR_FILE))
  })

  it('marks Cursor stdio entries with type stdio and leaves it off for Claude Code', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    for (const component of manifest.components.filter((c) => c.transport === 'stdio')) {
      assert.equal(readJson(dir, CURSOR_FILE).mcpServers[component.id].type, 'stdio')
      assert.equal(readJson(dir, MCP_FILE).mcpServers[component.id].type, undefined)
    }
  })

  it('writes nothing when no component is selected, and says how to opt in', async () => {
    const dir = project()
    const before = hashTree(dir)
    const result = await cli(dir, 'init', '--write')
    assert.equal(result.code, 0)
    if (manifest.components.every((c) => !c.enabledByDefault)) {
      assert.match(result.stderr, /Opt in with --with/)
      assert.equal(hashTree(dir), before)
    }
  })

  it('rejects unknown clients and components without writing', async () => {
    const dir = project()
    const before = hashTree(dir)
    for (const args of [
      ['--client', 'vim'],
      ['--with', 'no-such-component'],
    ]) {
      const result = await cli(dir, 'init', '--write', ...args)
      assert.equal(result.code, 1, args.join(' '))
      assert.match(result.stderr, /Unknown (client|component)/)
    }
    assert.equal(hashTree(dir), before)
  })

  it('is idempotent', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    const before = hashTree(dir)
    const again = await cli(dir, 'init', '--write', ...withAll)
    assert.match(again.stdout, /Nothing to change/)
    assert.equal(hashTree(dir), before)
  })
})

describe('merge, never clobber (FR-5)', () => {
  const existing = {
    mcpServers: {
      other: { command: 'other-mcp', args: ['--flag'] },
      // An earlier hand-written entry: unpinned, with an env var the user set.
      [allIds[0]]: { command: 'npx', args: ['-y', 'unpinned'], env: { DEBUG: '1' } },
    },
    someOtherKey: true,
  }

  it('keeps other servers, other keys and user fields; updates the kit entry in place', async () => {
    const dir = project({
      [MCP_FILE]: `${JSON.stringify(existing, null, 4)}\n`,
      [CURSOR_FILE]: `${JSON.stringify(existing, null, 2)}\n`,
    })
    await cli(dir, 'init', '--write', ...withAll)
    for (const file of [MCP_FILE, CURSOR_FILE]) {
      const config = readJson(dir, file)
      assert.deepEqual(config.mcpServers.other, existing.mcpServers.other, file)
      assert.equal(config.someOtherKey, true, file)
      const entry = config.mcpServers[allIds[0]]
      assert.deepEqual(entry.env, { DEBUG: '1' }, file)
      assert.notDeepEqual(entry.args, ['-y', 'unpinned'], file)
      assert.deepEqual(Object.keys(config.mcpServers), ['other', ...allIds], file)
    }
    assert.match(fs.readFileSync(path.join(dir, MCP_FILE), 'utf8'), /^ {4}"mcpServers"/m)
  })

  it('keeps CRLF line endings', async () => {
    const dir = project({ [MCP_FILE]: '{\r\n  "mcpServers": {}\r\n}\r\n' })
    await cli(dir, 'init', '--write', '--client', 'claude-code', ...withAll)
    const text = fs.readFileSync(path.join(dir, MCP_FILE), 'utf8')
    assert.equal(text.replace(/\r\n/g, ''), text.replace(/\n/g, '').replace(/\r/g, ''))
    assert.ok(!/[^\r]\n/.test(text))
  })

  it('refuses to touch a config it cannot parse, and writes nothing at all', async () => {
    for (const broken of ['{ "mcpServers": ', '[1, 2]', '{ "mcpServers": [] }']) {
      const dir = project({ [MCP_FILE]: broken })
      const before = hashTree(dir)
      const result = await cli(dir, 'init', '--write', ...withAll)
      assert.equal(result.code, 1, broken)
      assert.match(result.stderr, /\.mcp\.json/, broken)
      assert.equal(hashTree(dir), before, broken)
    }
  })
})

describe('denied tools (FR-7)', () => {
  function run(dir, components, generators) {
    const stderr = sink()
    const code = runInit({ root: dir, write: true, components, generators, stdout: sink(), stderr })
    return { code, stderr: stderr.text }
  }

  it('denies every listed tool in Claude Code settings, keeping existing rules once', () => {
    const dir = project({
      [SETTINGS_FILE]: JSON.stringify({
        permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)', 'mcp__signer__sign_message'] },
      }),
    })
    run(dir, [signer('exclude')], [claudeCode])
    const { permissions } = readJson(dir, SETTINGS_FILE)
    assert.deepEqual(permissions.allow, ['Bash(ls)'])
    assert.deepEqual(permissions.deny, [
      'Read(./.env)',
      'mcp__signer__sign_message',
      'mcp__signer__send_transaction',
    ])
    const expected = signer().deniedTools.map((tool) => `mcp__signer__${tool}`)
    assert.ok(expected.every((rule) => permissions.deny.includes(rule)))
  })

  it('writes no settings file when nothing needs denying', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    if (manifest.components.every((c) => c.deniedTools.length === 0)) {
      assert.ok(!exists(dir, SETTINGS_FILE))
    }
  })

  it('leaves a component out of Cursor when its fallback is exclude, and says so', () => {
    const dir = project()
    const { stderr } = run(dir, [signer('exclude')], [cursor])
    assert.ok(!exists(dir, CURSOR_FILE))
    assert.match(stderr, /signer is not configured for Cursor/)
  })

  it('installs it in Cursor with a warning when its fallback is warn', () => {
    const dir = project()
    const { stderr } = run(dir, [signer('warn')], [cursor])
    assert.ok(readJson(dir, CURSOR_FILE).mcpServers.signer)
    assert.match(stderr, /Cursor cannot deny individual tools: signer exposes send_transaction/)
  })
})

describe('no secrets and labels (FR-8, FR-17)', () => {
  it('writes no env values, keys or credentials', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    for (const file of [MCP_FILE, CURSOR_FILE]) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      assert.doesNotMatch(
        text,
        /"env"|0x[0-9a-fA-F]{64}|PRIVATE|SECRET|TOKEN|API_KEY|:\/\/[^/\s"]+@/i,
        file
      )
    }
  })

  it('labels experimental components', () => {
    assert.equal(label({ id: 'echidna', experimental: true }), 'echidna (experimental)')
    assert.equal(label({ id: 'solhint', experimental: false }), 'solhint')
  })
})
