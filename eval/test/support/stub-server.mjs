#!/usr/bin/env node
// Stub stdio MCP server for harness tests. Each flag switches on one misbehaviour a real
// candidate has shown (or could show), so the probe's handling of it is tested by execution.
//
//   --pollute             print a banner to stdout before answering (C3)
//   --interpolate-cwd     put process.cwd() into instructions (C2: varies by machine)
//   --hang-tools-list     answer initialize, never answer tools/list (the trailofbits/slither-mcp#35 pattern)
//   --exit-on-initialize  exit(3) when initialize arrives
//   --paged               split tools/list into two pages with a cursor
//   --tool-error          tools/call returns isError: true
//   --tools-list-error    tools/list answers with a JSON-RPC error
//   --grandchild          start a child that ignores SIGTERM; "<own pid> <child pid>" go to
//                         $SAK_PIDFILE
//   --ignore-sigterm      ignore SIGTERM and stdin EOF (only SIGKILL stops it)
//   --leak-key            put $PRIVATE_KEY into instructions (canary test)
//   --leak-key-stderr     print $PRIVATE_KEY to stderr at start-up
//   --leak-key-stdout     print six banner lines, then $PRIVATE_KEY, on stdout at start-up
//   --leak-key-description  put $PRIVATE_KEY into a tool description
//   --leak-key-schema     put $PRIVATE_KEY as an inputSchema default
//   --long-instructions   instructions of exactly 900 characters
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const flags = new Set(process.argv.slice(2))
const key = process.env.PRIVATE_KEY
const tools = [
  {
    name: 'lint',
    description: flags.has('--leak-key-description')
      ? `Lint a file (signer ${key})`
      : 'Lint a file',
    inputSchema: flags.has('--leak-key-schema')
      ? { type: 'object', properties: { signer: { type: 'string', default: key } } }
      : { type: 'object' },
  },
  { name: 'fix', description: 'Fix a file', inputSchema: { type: 'object' } },
]
if (flags.has('--leak-key-stderr')) process.stderr.write(`loaded key ${key}\n`)
if (flags.has('--leak-key-stdout')) {
  for (let i = 1; i <= 6; i++) process.stdout.write(`banner line ${i}\n`)
  process.stdout.write(`loaded key ${key}\n`)
}

if (flags.has('--ignore-sigterm')) {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1e9) // stay alive with stdin closed: only SIGKILL ends this process
}
// With --grandchild, answer nothing until the grandchild has its SIGTERM handler installed,
// so a fast close() really meets a process that ignores SIGTERM.
let ready = Promise.resolve()
if (flags.has('--grandchild')) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1e9)",
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  ready = new Promise((resolve) => child.stdout.once('data', resolve))
  fs.writeFileSync(process.env.SAK_PIDFILE, `${process.pid} ${child.pid}`)
}

if (flags.has('--pollute')) process.stdout.write('stub-server v0 starting\n')

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  await ready
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    handle(message)
  }
})
process.stdin.on('end', () => {
  if (!flags.has('--ignore-sigterm')) process.exit(0)
})

function handle({ id, method, params }) {
  if (method === 'initialize') {
    if (flags.has('--exit-on-initialize')) process.exit(3)
    const where = flags.has('--interpolate-cwd') ? ` Project root: ${process.cwd()}.` : ''
    const leak = flags.has('--leak-key') ? ` Signing as ${process.env.PRIVATE_KEY}.` : ''
    reply(id, {
      protocolVersion: params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'stub', version: '0.0.0' },
      instructions: flags.has('--long-instructions')
        ? 'x'.repeat(900)
        : `Lint before you finish.${where}${leak}`,
    })
  } else if (method === 'tools/list') {
    if (flags.has('--hang-tools-list')) return
    if (flags.has('--tools-list-error')) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'internal' } })}\n`
      )
      return
    }
    if (flags.has('--paged') && !params?.cursor) reply(id, { tools: [tools[0]], nextCursor: 'p2' })
    else if (flags.has('--paged')) reply(id, { tools: [tools[1]] })
    else reply(id, { tools })
  } else if (method === 'tools/call') {
    const isError = flags.has('--tool-error')
    reply(id, { content: [{ type: 'text', text: isError ? 'linter crashed' : 'ok' }], isError })
  }
}
