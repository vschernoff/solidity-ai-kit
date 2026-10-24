import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { STATUS, configuredInProject, formatReport, runDoctor } from '../src/doctor.js'
import { PACKAGE_ROOT, readPackageJson } from '../src/manifest.js'
import { probe, resolveNpx } from '../src/mcp-probe.js'

const packageJson = readPackageJson()
const bin = path.join(PACKAGE_ROOT, packageJson.bin[packageJson.name])
const stub = path.join(PACKAGE_ROOT, 'test', 'fixtures', 'stub-mcp-server.js')
const tempRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-doc-test-'))
)
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

// A manifest component that runs the stub in the given mode.
function stubComponent(id, mode, arg) {
  return {
    id,
    stage: 'lint',
    command: process.execPath,
    args: [stub, mode, ...(arg === undefined ? [] : [String(arg)])],
    version: '1.0.0',
    transport: 'stdio',
    source: 'https://example.com/stub',
    experimental: false,
    requiresBinaries: [],
    deniedTools: [],
  }
}

let counter = 0
function project(files = {}, { foundry = true } = {}) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  if (foundry) fs.writeFileSync(path.join(dir, 'foundry.toml'), '')
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

function mcpJson(...ids) {
  return JSON.stringify({ mcpServers: Object.fromEntries(ids.map((id) => [id, { command: 'x' }])) })
}

function hashTree(dir) {
  const hash = crypto.createHash('sha256')
  for (const entry of fs.readdirSync(dir, { recursive: true }).sort()) {
    hash.update(`${entry}\0`)
    const full = path.join(dir, entry)
    if (fs.statSync(full).isFile()) hash.update(fs.readFileSync(full))
  }
  return hash.digest('hex')
}

// Deterministic toolchain: forge present, anvil missing, cast present.
const runner = async (name) =>
  name === 'anvil' ? { found: false } : { found: true, version: `${name} 1.8.5-stable` }

function doctor(dir, components, options = {}) {
  return runDoctor({
    root: dir,
    manifest: { components },
    engines: '>=22',
    runner,
    timeoutMs: 5000,
    ...options,
  })
}

describe('probe: the MCP initialize handshake (FR-10, C3, C4)', () => {
  const launch = (mode, arg) => ({
    command: process.execPath,
    args: [stub, mode, ...(arg === undefined ? [] : [String(arg)])],
    cwd: tempRoot,
    timeoutMs: 3000,
  })

  it('reports a healthy server with its serverInfo and instructions', async () => {
    const result = await probe(launch('fixed', 40))
    assert.equal(result.status, 'healthy')
    assert.match(result.serverInfo.name, /^stub-\d+$/)
    assert.equal(result.serverInfo.version, '1.0.0')
    assert.equal(result.instructions.length, 40)
  })

  for (const [mode, reason] of [
    ['crash', /exited before answering \(code 3\)/],
    ['error', /initialize error: boom/],
    ['noise', /non-protocol output to stdout/],
  ]) {
    it(`fails, never healthy, when the server does "${mode}"`, async () => {
      const result = await probe(launch(mode))
      assert.equal(result.status, 'failed')
      assert.match(result.reason, reason)
    })
  }

  it('returns only after the server has exited', async () => {
    const result = await probe(launch('fixed', 5))
    assert.throws(() => process.kill(result.pid, 0), /ESRCH/)
  })

  it('times out a server that never answers and has gone when it returns', async () => {
    const result = await probe({ ...launch('hang'), timeoutMs: 500 })
    assert.equal(result.status, 'failed')
    assert.match(result.reason, /no initialize response within 0.5 s/)
    assert.throws(() => process.kill(result.pid, 0), /ESRCH/)
  })

  it('kills a server that ignores end of input', async () => {
    const result = await probe({ ...launch('stubborn'), timeoutMs: 500 })
    assert.equal(result.status, 'failed')
    assert.throws(() => process.kill(result.pid, 0), /ESRCH/)
  })

  const pidOf = (result) => Number(result.serverInfo.name.replace('stub-', ''))
  // A killed process can linger briefly as a zombie until it is reaped (its parent here has
  // exited too, so the system reaps it). A zombie holds no resources or working directory,
  // but kill(pid, 0) still finds it, so wait up to 2 s for it to be reaped.
  async function gone(pid) {
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (error.code === 'ESRCH') return
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail(`pid ${pid} is still alive 2 s after probe returned`)
  }

  it('kills a server that ignores both end of input and SIGTERM', async () => {
    const result = await probe({ ...launch('immortal'), graceMs: 200 })
    assert.equal(result.status, 'healthy')
    await gone(pidOf(result))
  })

  it('kills the whole tree when a wrapper (like npx) runs the real server', async () => {
    const result = await probe({ ...launch('wrapper'), graceMs: 200 })
    assert.equal(result.status, 'healthy')
    await gone(result.pid)
    // The server itself is the wrapper's child, and it ignores SIGTERM.
    await gone(pidOf(result))
  })

  it('fails a response that has no serverInfo', async () => {
    const result = await probe(launch('noinfo'))
    assert.equal(result.status, 'failed')
    assert.match(result.reason, /no serverInfo/)
  })

  it('leaves its working directory free to delete (Windows refuses while in use)', async () => {
    const cwd = fs.mkdtempSync(path.join(tempRoot, 'cwd-'))
    await probe({ ...launch('fixed', 5), cwd })
    fs.rmSync(cwd, { recursive: true })
    assert.ok(!fs.existsSync(cwd))
  })

  it('reports a missing executable as missing', async () => {
    const result = await probe({ ...launch('fixed'), command: 'no-such-binary-solidity-ai-kit' })
    assert.equal(result.status, 'missing')
  })
})

describe('doctor checks and report (FR-10, FR-11)', () => {
  it('marks one failing server red and fails the run, keeping the healthy one green', async () => {
    const components = [stubComponent('good', 'fixed', 10), stubComponent('bad', 'crash')]
    const dir = project({ '.mcp.json': mcpJson('good', 'bad') })
    const report = await doctor(dir, components)
    const byName = Object.fromEntries(report.components.map((check) => [check.name, check]))
    assert.equal(byName.good.status, STATUS.healthy)
    assert.equal(byName.bad.status, STATUS.failed)
    assert.equal(formatReport(report).ok, false)
  })

  it('distinguishes missing, wrong version, failed to start and healthy, one fix line each', async () => {
    const missing = { ...stubComponent('gone', 'fixed'), command: 'no-such-binary-solidity-ai-kit' }
    const components = [
      stubComponent('ok', 'fixed', 10),
      { ...stubComponent('old', 'version', '0.9.0'), package: 'old-mcp' },
      stubComponent('broken', 'error'),
      missing,
    ]
    const dir = project({ '.mcp.json': mcpJson('ok', 'old', 'broken', 'gone') })
    // `old` is an npm component, so doctor launches it through npx; send that launch to the
    // stub, which reports an older version than the manifest pins.
    const prober = (launch) =>
      launch.args.includes('old-mcp@1.0.0')
        ? probe({ ...launch, command: process.execPath, args: [stub, 'version', '0.9.0'] })
        : probe(launch)
    const report = await doctor(dir, components, { prober })
    const normalized = formatReport(report)
      .text.replaceAll(dir, '<project>')
      .replace(/^ {2}healthy {9}Node: .*$/m, '  healthy         Node: <version>')
      .replace(/from \S*solidity-ai-kit-doctor-\S+/g, 'from <temp>')
      .replace(/: stub-\d+ /g, ': stub ')
    assert.equal(
      normalized,
      [
        'Project: foundry at <project>',
        '',
        'Toolchain',
        '  healthy         Node: <version>',
        '  healthy         forge: forge 1.8.5-stable',
        '  missing         anvil: not on PATH',
        '                  → Install Foundry: https://getfoundry.sh/introduction/installation',
        '  healthy         cast: cast 1.8.5-stable',
        '',
        'Components',
        '  healthy         ok: stub 1.0.0',
        '                  instructions: 10 chars from <project>',
        '                  instructions: 10 chars from <temp>',
        '  wrong version   old: reports 0.9.0, manifest pins 1.0.0',
        '                  → Run `npx -y old-mcp@1.0.0` in the project to see the error.',
        '  failed to start broken: initialize error: boom',
        '                  → See https://example.com/stub.',
        '  missing         gone: no-such-binary-solidity-ai-kit not found',
        '                  → See https://example.com/stub.',
        '',
        '4 problem(s); see the → lines above.',
        '',
      ].join('\n')
    )
  })

  it('does not require Foundry outside a Foundry project', async () => {
    const report = await doctor(project({}, { foundry: false }), [], {
      runner: async () => ({ found: false }),
    })
    assert.deepEqual(
      report.toolchain.filter(({ name }) => name !== 'Node').map(({ status }) => status),
      [STATUS.skipped, STATUS.skipped, STATUS.skipped]
    )
    assert.equal(formatReport(report).ok, true)
  })

  it('checks binaries a component requires', async () => {
    const needsEchidna = { ...stubComponent('fuzz', 'fixed', 1), requiresBinaries: ['echidna'] }
    const dir = project({ '.mcp.json': mcpJson('fuzz') })
    const report = await doctor(dir, [needsEchidna], {
      runner: async (name) =>
        name === 'echidna' ? { found: false } : { found: true, version: '1' },
    })
    const echidna = report.toolchain.find(({ name }) => name === 'echidna')
    assert.equal(echidna.status, STATUS.missing)
    assert.match(echidna.fix, /Needed by fuzz/)
  })

  it('reports an http component as not checked, which is not a pass', async () => {
    const http = {
      ...stubComponent('remote', 'fixed'),
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    }
    // Every toolchain check passes here, so only the http component can fail the run.
    const allFound = async (name) => ({ found: true, version: `${name} 1` })
    const report = await doctor(project({ '.mcp.json': mcpJson('remote') }), [http], {
      runner: allFound,
    })
    assert.equal(report.components[0].status, STATUS.notChecked)
    assert.equal(formatReport(report).ok, false)
  })
})

describe('instructions length (FR-12)', () => {
  it('measures from two directories and flags a path-interpolated text as variable', async () => {
    const dir = project({ '.mcp.json': mcpJson('pathy') })
    const report = await doctor(dir, [stubComponent('pathy', 'path')])
    const { instructions } = report.components[0]
    assert.equal(instructions.lengths.length, 2)
    assert.equal(instructions.lengths[0].dir, dir)
    assert.notEqual(instructions.lengths[0].length, instructions.lengths[1].length)
    assert.equal(instructions.variable, true)
    assert.match(formatReport(report).text, /instructions are variable/)
  })

  it('warns, naming Codex, only when Codex is configured, and never fails for it', async () => {
    const component = stubComponent('long', 'fixed', 600)
    const withCodex = project({
      '.codex/config.toml': '[mcp_servers.long]\ncommand = "x"\n',
    })
    const report = await doctor(withCodex, [component])
    const { text, ok } = formatReport(report)
    assert.match(
      text,
      /long: instructions are 600 chars, which exceeds the ~512 chars Codex's guidance recommends \(Codex\)/
    )
    assert.equal(report.components[0].instructions.variable, false)
    assert.equal(ok, false, 'anvil is missing in this toolchain stub')
    assert.equal(report.components[0].status, STATUS.healthy)

    const claudeOnly = await doctor(project({ '.mcp.json': mcpJson('long') }), [component])
    assert.deepEqual(claudeOnly.components[0].warnings, [])
  })

  it('takes per-client limits', async () => {
    const dir = project({ '.codex/config.toml': '[mcp_servers.long]\ncommand = "x"\n' })
    const report = await doctor(dir, [stubComponent('long', 'fixed', 600)], {
      limits: { codex: 1000 },
    })
    assert.deepEqual(report.components[0].warnings, [])
  })
})

describe('doctor changes nothing (FR-13)', () => {
  it('leaves the project byte-identical and removes its temp directory', async () => {
    const dir = project({ '.mcp.json': mcpJson('pathy') })
    const before = hashTree(dir)
    // A private temp root: the shared system one also holds directories of any other doctor
    // run on the machine, which made a before/after count there flaky.
    const ownTemp = fs.mkdtempSync(path.join(tempRoot, 'temp-root-'))
    let seen = []
    const prober = async (launch) => {
      seen = fs.readdirSync(ownTemp)
      return probe(launch)
    }
    await doctor(dir, [stubComponent('pathy', 'path')], { tempRoot: ownTemp, prober })
    assert.equal(hashTree(dir), before)
    assert.equal(seen.length, 1, 'doctor made its directory under the temp root it was given')
    assert.deepEqual(fs.readdirSync(ownTemp), [], 'and removed it')
  })
})

describe('reading what init configured', () => {
  it('finds kit components and the clients they are configured for', () => {
    const dir = project({
      '.mcp.json': mcpJson('a', 'unrelated'),
      '.codex/config.toml': '[mcp_servers.a]\ncommand = "x"\n[mcp_servers.b]\ncommand = "y"\n',
      '.cursor/mcp.json': '{ not json',
    })
    const { found, unreadable } = configuredInProject(dir, {
      components: [{ id: 'a' }, { id: 'b' }],
    })
    assert.deepEqual([...found.get('a')].sort(), ['claude-code', 'codex'])
    assert.deepEqual([...found.get('b')], ['codex'])
    assert.ok(!found.has('unrelated'))
    assert.deepEqual(unreadable, [path.join('.cursor', 'mcp.json')])
  })
})

describe('npx on Windows', () => {
  it('uses npm’s npx-cli.js through node, never a shell', () => {
    const npmDir = path.join(tempRoot, 'npm-bin')
    fs.mkdirSync(npmDir, { recursive: true })
    fs.writeFileSync(path.join(npmDir, 'npx-cli.js'), '')
    const found = resolveNpx({
      platform: 'win32',
      env: { npm_execpath: path.join(npmDir, 'npm-cli.js') },
    })
    assert.equal(found.command, process.execPath)
    assert.ok(found.prefix[0].endsWith('npx-cli.js'))
    assert.deepEqual(resolveNpx({ platform: 'linux', env: {} }), { command: 'npx', prefix: [] })
  })
})

describe('doctor through the CLI', () => {
  async function cli(cwd, ...args) {
    return cliWith({}, cwd, ...args)
  }

  async function cliWith(env, cwd, ...args) {
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [bin, ...args], {
        cwd,
        env: { ...process.env, ...env },
      })
      return { code: 0, stdout, stderr }
    } catch (error) {
      if (typeof error.code !== 'number') throw error
      return { code: error.code, stdout: error.stdout, stderr: error.stderr }
    }
  }

  it('exits non-zero when a check fails (forge missing in a Foundry project)', async () => {
    // An empty PATH makes forge, anvil and cast missing on any machine.
    const result = await cliWith({ PATH: '' }, project(), 'doctor')
    assert.equal(result.code, 1)
    assert.match(result.stdout, /missing {9}forge: not on PATH/)
    assert.match(result.stdout, /3 problem\(s\)/)
  })

  it('says when nothing is configured', async () => {
    const result = await cli(project({}, { foundry: false }), 'doctor')
    assert.match(result.stdout, /none configured here/)
  })

  it('rejects a bad --limit or --timeout', async () => {
    for (const args of [
      ['--limit', 'codex'],
      ['--limit', 'vim=5'],
      ['--timeout', '0'],
    ]) {
      const result = await cli(project({}, { foundry: false }), 'doctor', ...args)
      assert.equal(result.code, 1, args.join(' '))
    }
  })
})
