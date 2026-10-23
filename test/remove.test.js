import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { parse as parseToml } from 'smol-toml'
import { claudeCode, claudeCodeRemove, SETTINGS_FILE } from '../src/clients/claude-code.js'
import { runInit } from '../src/init.js'
import { PACKAGE_ROOT, loadManifest, readPackageJson } from '../src/manifest.js'
import { runRemove } from '../src/remove.js'
import { END, START, withoutBlock } from '../src/rules.js'

const manifest = loadManifest()
const packageJson = readPackageJson()
const bin = path.join(PACKAGE_ROOT, packageJson.bin[packageJson.name])
const withAll = manifest.components.flatMap(({ id }) => ['--with', id])
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-remove-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
const symlinkTest = process.platform === 'win32' ? it.skip : it

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

function hashTree(dir) {
  const hash = crypto.createHash('sha256')
  for (const entry of fs.readdirSync(dir, { recursive: true }).sort()) {
    hash.update(`${entry}\0`)
    const full = path.join(dir, entry)
    if (fs.lstatSync(full).isFile()) hash.update(fs.readFileSync(full))
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

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8')

describe('remove undoes init (FR-9)', () => {
  it('round-trips a fresh project to the original tree, created directories included', async () => {
    const dir = project()
    const before = hashTree(dir)
    assert.equal((await cli(dir, 'init', '--write', ...withAll)).code, 0)
    assert.notEqual(hashTree(dir), before)
    const result = await cli(dir, 'remove', '--write')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(hashTree(dir), before)
  })

  it('round-trips a project whose own files the kit merged into, byte for byte', async () => {
    // Files written the way the kit formats them, so re-serialization changes nothing.
    const dir = project({
      'AGENTS.md': '# Agents\n\nOur own notes.\n',
      'CLAUDE.md': '# Claude notes\n',
      '.mcp.json': `${JSON.stringify({ mcpServers: { other: { command: 'other' } } }, null, 2)}\n`,
      '.codex/config.toml':
        '# my config\nmodel = "gpt-x"\n\n[mcp_servers.other]\ncommand = "other"\n',
    })
    const before = hashTree(dir)
    await cli(dir, 'init', '--write', ...withAll)
    await cli(dir, 'remove', '--write')
    assert.equal(hashTree(dir), before)
  })

  it('restores the content of a hand-formatted JSON config (layout is the kit’s)', async () => {
    const original = '{"mcpServers":{"other":{"command":"other"}},"extra":[1,2]}\n'
    const dir = project({ '.mcp.json': original })
    await cli(dir, 'init', '--write', ...withAll)
    await cli(dir, 'remove', '--write')
    assert.deepEqual(JSON.parse(read(dir, '.mcp.json')), JSON.parse(original))
  })

  it('previews without --write and leaves the tree untouched', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    const before = hashTree(dir)
    const result = await cli(dir, 'remove')
    assert.equal(result.code, 0)
    assert.match(result.stdout, /Preview only; nothing was written/)
    assert.match(result.stdout, /\.cursor\/ \(empty directory, deleted\)/)
    assert.equal(hashTree(dir), before)
  })

  it('says when there is nothing to remove', async () => {
    const result = await cli(project(), 'remove', '--write')
    assert.equal(result.code, 0)
    assert.match(result.stdout, /Nothing to remove/)
  })

  it('removes only what the selected clients use', async () => {
    const dir = project()
    await cli(dir, 'init', '--write', ...withAll)
    await cli(dir, 'remove', '--write', '--client', 'cursor')
    assert.ok(!fs.existsSync(path.join(dir, '.cursor')))
    assert.ok(fs.existsSync(path.join(dir, '.mcp.json')))
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')))
    // Codex also reads AGENTS.md, but only cursor was named, so AGENTS.md loses its block.
    assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')))
    assert.ok(fs.existsSync(path.join(dir, '.codex', 'config.toml')))
  })

  it('keeps a user’s other Codex servers and comments', async () => {
    const dir = project({
      '.codex/config.toml': '# keep me\n[mcp_servers.other]\ncommand = "other"\n',
    })
    await cli(dir, 'init', '--write', ...withAll)
    await cli(dir, 'remove', '--write')
    const text = read(dir, path.join('.codex', 'config.toml'))
    assert.ok(text.includes('# keep me'))
    assert.deepEqual(Object.keys(parseToml(text).mcp_servers), ['other'])
  })

  it('refuses a Codex config it cannot edit safely, writing nothing', async () => {
    const id = manifest.components[0].id
    const config = `mcp_servers = { ${id} = { command = "x" } }\n`
    const dir = project({ '.codex/config.toml': config })
    const before = hashTree(dir)
    const result = await cli(dir, 'remove', '--write')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /cannot remove safely/)
    assert.equal(hashTree(dir), before)
  })

  it('refuses a damaged rules block, writing nothing', async () => {
    const dir = project({ 'AGENTS.md': `${START}\nno end marker\n` })
    const before = hashTree(dir)
    const result = await cli(dir, 'remove', '--write')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /damaged solidity-ai-kit block/)
    assert.equal(hashTree(dir), before)
  })

  symlinkTest('removes the block once when CLAUDE.md is a symlink to AGENTS.md', async () => {
    const dir = project({ 'AGENTS.md': '# Shared\n' })
    fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'))
    await cli(dir, 'init', '--write', ...withAll)
    const result = await cli(dir, 'remove', '--write')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(read(dir, 'AGENTS.md'), '# Shared\n')
    assert.ok(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isSymbolicLink())
  })
})

describe('removing denied-tool rules (FR-9, FR-7)', () => {
  const signer = {
    id: 'signer',
    package: 'signer-mcp',
    version: '1.0.0',
    transport: 'stdio',
    deniedTools: ['send_transaction'],
    denyFallback: 'exclude',
  }

  it('removes the kit’s deny rules and keeps the user’s', () => {
    const dir = project({
      [SETTINGS_FILE]: `${JSON.stringify({ permissions: { deny: ['Read(./.env)'] } }, null, 2)}\n`,
    })
    const before = hashTree(dir)
    const quiet = { stdout: sink(), stderr: sink() }
    runInit({ root: dir, write: true, components: [signer], generators: [claudeCode], ...quiet })
    assert.ok(read(dir, SETTINGS_FILE).includes('mcp__signer__send_transaction'))
    runRemove({
      root: dir,
      write: true,
      components: [signer],
      removers: [claudeCodeRemove],
      ...quiet,
    })
    assert.equal(hashTree(dir), before)
  })

  it('deletes a settings file and .claude/ that init created for deny rules alone', () => {
    const dir = project()
    const before = hashTree(dir)
    const quiet = { stdout: sink(), stderr: sink() }
    runInit({ root: dir, write: true, components: [signer], generators: [claudeCode], ...quiet })
    runRemove({
      root: dir,
      write: true,
      components: [signer],
      removers: [claudeCodeRemove],
      ...quiet,
    })
    assert.equal(hashTree(dir), before)
    assert.ok(!fs.existsSync(path.join(dir, '.claude')))
  })
})

describe('withoutBlock', () => {
  const block = `${START}\nrules\n${END}`
  it('removes the block and the blank line before it, keeping text around it', () => {
    assert.equal(withoutBlock('A.md', `# A\n\n${block}\n`), '# A\n')
    assert.equal(withoutBlock('A.md', `# A\n\n${block}\n\n## After\n`), '# A\n\n## After\n')
  })
  it('returns null for a file holding only the block, undefined when there is none', () => {
    assert.equal(withoutBlock('A.md', `${block}\n`), null)
    assert.equal(withoutBlock('A.md', '# A\n'), undefined)
    assert.equal(withoutBlock('A.md', null), undefined)
  })
  it('keeps CRLF line endings', () => {
    assert.equal(withoutBlock('A.md', `# A\r\n\r\n${START}\r\nx\r\n${END}\r\n`), '# A\r\n')
  })
})
