import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { runInit } from '../src/init.js'
import { PACKAGE_ROOT, readPackageJson } from '../src/manifest.js'

const packageJson = readPackageJson()
const bin = path.join(PACKAGE_ROOT, packageJson.bin[packageJson.name])
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-init-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

let counter = 0
function project(files) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

// Every path (files and directories) and every file's bytes, so a created empty directory
// counts as a change too.
function hashTree(dir) {
  const hash = crypto.createHash('sha256')
  for (const entry of fs.readdirSync(dir, { recursive: true }).sort()) {
    const full = path.join(dir, entry)
    hash.update(`${entry}\0`)
    if (fs.statSync(full).isFile()) hash.update(fs.readFileSync(full))
  }
  return hash.digest('hex')
}

function capture() {
  let text = ''
  return {
    write: (chunk) => (text += chunk),
    get text() {
      return text
    },
  }
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

const FIXTURE = {
  'foundry.toml': '[profile.default]\nsrc = "src"\n',
  '.mcp.json': '{\n  "mcpServers": {}\n}\n',
  'src/Counter.sol': 'contract Counter {}\n',
}

// Stands in for the config writers until they land: one new file, one modified file.
const fakeGenerator = () => [
  { file: 'AGENTS.md', after: '# Agents\n' },
  { file: '.mcp.json', after: '{\n  "mcpServers": { "x": {} }\n}\n' },
]

describe('init preview and --write (FR-2)', () => {
  it('leaves the tree byte-identical without --write (real bin)', async () => {
    const dir = project(FIXTURE)
    const before = hashTree(dir)
    const result = await cli(dir, 'init')
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^Project: foundry \(foundry\.toml\)/)
    assert.equal(hashTree(dir), before)
  })

  it('prints the diff and writes nothing in preview', () => {
    const dir = project(FIXTURE)
    const before = hashTree(dir)
    const stdout = capture()
    assert.equal(runInit({ root: dir, generators: [fakeGenerator], stdout, stderr: capture() }), 0)
    assert.equal(hashTree(dir), before)
    assert.match(stdout.text, /^--- \/dev\/null\n\+\+\+ b\/AGENTS\.md$/m)
    assert.match(stdout.text, /^\+ {2}"mcpServers": \{ "x": \{\} \}$/m)
    assert.match(stdout.text, /nothing was written/)
  })

  it('writes exactly the previewed contents with write: true', () => {
    const dir = project(FIXTURE)
    const stdout = capture()
    const code = runInit({
      root: dir,
      write: true,
      generators: [fakeGenerator],
      stdout,
      stderr: capture(),
    })
    assert.equal(code, 0)
    for (const { file, after } of fakeGenerator()) {
      assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), after)
    }
    assert.equal(
      fs.readFileSync(path.join(dir, 'src/Counter.sol'), 'utf8'),
      FIXTURE['src/Counter.sol']
    )
    assert.match(stdout.text, /^Wrote:$/m)
  })

  it('is idempotent: a second run has nothing to change', () => {
    const dir = project(FIXTURE)
    const quiet = { stdout: capture(), stderr: capture() }
    runInit({ root: dir, write: true, generators: [fakeGenerator], ...quiet })
    const again = capture()
    runInit({
      root: dir,
      write: true,
      generators: [fakeGenerator],
      stdout: again,
      stderr: capture(),
    })
    assert.match(again.text, /Nothing to change/)
  })

  it('refuses to run from a subdirectory of a project, and writes nothing', async () => {
    const dir = project(FIXTURE)
    const before = hashTree(dir)
    const result = await cli(path.join(dir, 'src'), 'init', '--write')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Run init from the project root/)
    assert.equal(hashTree(dir), before)
  })
})
