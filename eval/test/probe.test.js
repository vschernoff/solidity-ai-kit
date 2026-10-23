import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { callTool, initialize, startStdio } from '../harness/mcp-client.js'
import {
  charLength,
  diffSnapshots,
  probeServer,
  staleDenials,
  toolSnapshot,
} from '../harness/probe.js'

const STUB = path.join(import.meta.dirname, 'support', 'stub-server.mjs')
const stub = (...flags) => ({
  id: 'stub',
  transport: 'stdio',
  command: process.execPath,
  args: [STUB, ...flags],
  env: { PATH: process.env.PATH },
})
const fast = { timeouts: { initializeMs: 5_000, toolsListMs: 1_000 } }

describe('handshake probe (eval-design §3)', () => {
  it('records a healthy server from two working directories', async () => {
    const result = await probeServer(stub(), fast)
    assert.equal(result.healthy, true, JSON.stringify(result.errors))
    assert.deepEqual(result.serverInfo, { name: 'stub', version: '0.0.0' })
    assert.deepEqual(result.instructions.chars, [23, 23])
    assert.equal(result.instructions.variable, false)
    assert.deepEqual(Object.keys(result.tools), ['fix', 'lint'])
    assert.equal(result.stdoutPollutionBytes, 0)
  })

  it('flags instructions that change with the working directory (C2)', async () => {
    const result = await probeServer(stub('--interpolate-cwd'), fast)
    assert.equal(result.instructions.variable, true)
    assert.ok(result.instructions.chars[1] > result.instructions.chars[0])
  })

  it('counts non-protocol bytes on stdout and marks the server unhealthy (C3)', async () => {
    const result = await probeServer(stub('--pollute'), fast)
    assert.equal(result.stdoutPollutionBytes, 2 * 'stub-server v0 starting\n'.length)
    assert.deepEqual(result.stdoutPollutionSamples[0], 'stub-server v0 starting')
    assert.equal(result.healthy, false)
  })

  it('reports initialize-ok-but-tools/list-hangs as a timeout, never as zero tools (C4)', async () => {
    const result = await probeServer(stub('--hang-tools-list'), fast)
    assert.equal(result.healthy, false)
    assert.equal(result.tools, null)
    assert.equal(result.toolCount, null)
    assert.deepEqual(
      result.errors.map((e) => [e.step, e.kind]),
      [
        ['tools/list', 'timeout'],
        ['tools/list', 'timeout'],
      ]
    )
  })

  it('reports a server that dies on initialize', async () => {
    const result = await probeServer(stub('--exit-on-initialize'), fast)
    assert.equal(result.healthy, false)
    assert.deepEqual(
      new Set(result.errors.map((e) => `${e.step}:${e.kind}`)),
      new Set(['initialize:exited'])
    )
  })

  it('reports a command that does not exist', async () => {
    const result = await probeServer(
      { id: 'missing', transport: 'stdio', command: 'sak-no-such-binary', args: [], env: {} },
      fast
    )
    assert.equal(result.healthy, false)
    assert.equal(result.errors[0].kind, 'exited')
  })

  // The four tests below close mutation gaps the Reviewer found on PR #7.
  it('reports a JSON-RPC error from tools/list as an error, never as zero healthy tools (C4)', async () => {
    const result = await probeServer(stub('--tools-list-error'), fast)
    assert.equal(result.healthy, false)
    assert.equal(result.toolCount, null)
    assert.deepEqual(
      result.errors.map((e) => [e.step, e.kind]),
      [
        ['tools/list', 'rpc'],
        ['tools/list', 'rpc'],
      ]
    )
  })

  it('leaves no orphans: kills the process group, with SIGKILL when SIGTERM is ignored', async () => {
    const pidfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sak-pid-')), 'pid')
    const session = startStdio({
      command: process.execPath,
      args: [STUB, '--grandchild', '--ignore-sigterm'],
      env: { PATH: process.env.PATH, SAK_PIDFILE: pidfile },
    })
    const pids = () => fs.readFileSync(pidfile, 'utf8').split(' ').map(Number)
    const alive = (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    let deadline
    try {
      await initialize(session, 5_000)
      assert.deepEqual(pids().filter(alive).length, 2, 'stub and grandchild should be running')
      // Bounded: a close() that never kills must fail this test, not hang the runner.
      await Promise.race([
        session.close(300),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('close() did not finish in 10 s')), 10_000)
        }),
      ])
      assert.deepEqual(session.stats.exit, { code: null, signal: 'SIGKILL' })
      assert.deepEqual(pids().filter(alive), [], 'server or grandchild survived close()')
    } finally {
      clearTimeout(deadline)
      for (const pid of fs.existsSync(pidfile) ? pids() : []) {
        if (alive(pid)) process.kill(pid, 'SIGKILL')
      }
    }
  })

  it('follows tools/list cursors', async () => {
    const result = await probeServer(stub('--paged'), fast)
    assert.equal(result.toolCount, 2)
  })

  it('passes isError from tools/call through', async () => {
    const session = startStdio({ command: process.execPath, args: [STUB, '--tool-error'] })
    try {
      await initialize(session, 5_000)
      const call = await callTool(session, 'lint', {}, 5_000)
      assert.equal(call.isError, true)
      assert.equal(call.content[0].text, 'linter crashed')
      assert.ok(call.bytes > 0)
    } finally {
      await session.close()
    }
  })
})

describe('tool snapshots', () => {
  const tools = [
    { name: 'b', description: 'B', inputSchema: { type: 'object' } },
    { name: 'a', description: 'A', inputSchema: { type: 'object' } },
  ]

  it('is order-independent', () => {
    assert.deepEqual(toolSnapshot(tools), toolSnapshot([...tools].reverse()))
  })

  it('reports added, removed and changed tools', () => {
    const before = toolSnapshot(tools)
    const after = toolSnapshot([
      { name: 'a', description: 'A, now different', inputSchema: { type: 'object' } },
      { name: 'cast_send', description: 'Sign and send', inputSchema: { type: 'object' } },
    ])
    assert.deepEqual(diffSnapshots(before, after), {
      added: ['cast_send'],
      removed: ['b'],
      changed: ['a'],
    })
  })

  it('treats a changed input schema as a changed tool', () => {
    const before = toolSnapshot([{ name: 'lint', inputSchema: { type: 'object' } }])
    const after = toolSnapshot([
      { name: 'lint', inputSchema: { type: 'object', properties: { config: { type: 'object' } } } },
    ])
    assert.deepEqual(diffSnapshots(before, after), { added: [], removed: [], changed: ['lint'] })
  })

  it('finds deny-list entries the server no longer exposes (FR-7)', () => {
    assert.deepEqual(staleDenials(['a', 'cast_send'], ['cast_send', 'forge_script']), [
      'forge_script',
    ])
  })

  it('counts characters as code points, astral ones included', () => {
    assert.equal(charLength('a—b'), 3)
    assert.equal(charLength('𝔘𝔫𝔦'), 3)
    assert.equal('𝔘𝔫𝔦'.length, 6)
    assert.equal(charLength(null), 0)
  })
})

describe('Streamable HTTP', () => {
  let server
  let url
  const seen = []

  before(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const message = JSON.parse(body)
        seen.push({ method: message.method, headers: req.headers })
        if (message.id === undefined) return res.writeHead(202).end()
        const result =
          message.method === 'initialize'
            ? {
                protocolVersion: '2025-06-18',
                serverInfo: { name: 'http-stub' },
                instructions: 'x'.repeat(611),
              }
            : { tools: [{ name: 'get_logs', inputSchema: { type: 'object' } }] }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' })
        res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`
        )
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${server.address().port}/mcp`
  })

  after(() => new Promise((resolve) => server.close(resolve)))

  it('handshakes over SSE responses and carries the session id', async () => {
    const result = await probeServer({ id: 'http', transport: 'http', url }, fast)
    assert.equal(result.healthy, true, JSON.stringify(result.errors))
    assert.deepEqual(result.instructions.chars, [611])
    assert.equal(result.toolCount, 1)
    const listCall = seen.find((s) => s.method === 'tools/list')
    assert.equal(listCall.headers['mcp-session-id'], 'sess-1')
    assert.equal(listCall.headers['mcp-protocol-version'], '2025-06-18')
  })

  it('reports an unreachable endpoint as an error', async () => {
    const result = await probeServer(
      { id: 'down', transport: 'http', url: 'http://127.0.0.1:9/mcp' },
      fast
    )
    assert.equal(result.healthy, false)
    assert.equal(result.errors[0].step, 'initialize')
  })
})
