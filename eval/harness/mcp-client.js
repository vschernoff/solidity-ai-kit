// A deliberately small MCP client for the evaluation harness.
//
// Why not the official SDK: the harness has to see what the SDK hides — every byte a stdio
// server writes to stdout that is not a JSON-RPC message (C3), the raw size of each response,
// and a request that never gets an answer (the "initialize works, tools/list hangs" failure).
// It speaks only what evaluation needs: initialize, tools/list (paged), tools/call.
import { spawn } from 'node:child_process'

export const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'solidity-ai-kit-eval', version: '0.0.0' }

export class McpError extends Error {
  /** kind: timeout | exited | protocol | rpc | http */
  constructor(kind, message, detail = {}) {
    super(message)
    this.kind = kind
    this.detail = detail
  }
}

function isJsonRpc(value) {
  return value && typeof value === 'object' && value.jsonrpc === '2.0'
}

/**
 * Start a stdio server. `command` and `args` go to spawn as an argv array; there is no shell.
 * Returns a session with request/notify/close and a live `stats` object.
 */
export function startStdio({ command, args = [], cwd, env, requestTimeoutMs = 30_000 }) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const stats = {
    stdoutBytes: 0,
    pollutionBytes: 0,
    pollutionSamples: [],
    pollutionText: '',
    stderr: '',
    exit: null,
    spawnError: null,
  }
  const pending = new Map()
  let buffer = ''
  let nextId = 1

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    pending.clear()
  }

  child.on('error', (error) => {
    stats.spawnError = error.message
    rejectAll(new McpError('exited', `could not start ${command}: ${error.message}`))
  })
  // 'close' fires after stdout has drained, so answers sent just before exiting still count.
  child.on('close', (code, signal) => {
    stats.exit = { code, signal }
    rejectAll(new McpError('exited', `server exited (code ${code}, signal ${signal})`, stats.exit))
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    if (stats.stderr.length < 256 * 1024) stats.stderr += chunk
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stats.stdoutBytes += Buffer.byteLength(chunk)
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      handleLine(line)
    }
  })

  function handleLine(line) {
    if (line.trim() === '') return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      message = null
    }
    if (!isJsonRpc(message)) {
      stats.pollutionBytes += Buffer.byteLength(line) + 1
      if (stats.pollutionSamples.length < 5) stats.pollutionSamples.push(line.slice(0, 200))
      // Kept whole (up to 256 KiB) so a secret printed on stdout is found wherever it appears.
      if (stats.pollutionText.length < 256 * 1024) stats.pollutionText += `${line}\n`
      return
    }
    if (message.id !== undefined && pending.has(message.id) && !message.method) {
      const { resolve, reject, timer } = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(timer)
      const bytes = Buffer.byteLength(line)
      if (message.error)
        reject(new McpError('rpc', message.error.message, { ...message.error, bytes }))
      else resolve({ result: message.result, bytes })
    }
    // Server-initiated requests and notifications (logging, list_changed) are ignored.
  }

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  return {
    transport: 'stdio',
    stats,
    request(method, params = {}, timeoutMs = requestTimeoutMs) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new McpError('timeout', `${method} got no answer in ${timeoutMs} ms`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        try {
          send({ jsonrpc: '2.0', id, method, params })
        } catch (error) {
          clearTimeout(timer)
          pending.delete(id)
          reject(new McpError('exited', `cannot write to server: ${error.message}`))
        }
      })
    },
    notify(method, params = {}) {
      send({ jsonrpc: '2.0', method, params })
    },
    async close(graceMs = 2_000) {
      if (stats.exit) return
      const exited = new Promise((resolve) => child.once('close', resolve))
      child.stdin.end()
      const killTree = (signal) => {
        try {
          if (process.platform === 'win32') child.kill(signal)
          else process.kill(-child.pid, signal)
        } catch {
          // Already gone.
        }
      }
      killTree('SIGTERM')
      const timer = setTimeout(() => killTree('SIGKILL'), graceMs)
      await exited
      clearTimeout(timer)
    },
  }
}

function parseSse(text) {
  const messages = []
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data) messages.push(data)
  }
  return messages
}

/** Connect to a Streamable HTTP server (e.g. a hosted endpoint or Echidna's --server). */
export function connectHttp({ url, headers = {}, requestTimeoutMs = 30_000 }) {
  const stats = { pollutionBytes: 0, pollutionSamples: [], sessionId: null }
  let nextId = 1
  let protocolVersion = null

  async function post(message, timeoutMs) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(stats.sessionId ? { 'mcp-session-id': stats.sessionId } : {}),
        ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
        ...headers,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error) => {
      const kind = error.name === 'TimeoutError' ? 'timeout' : 'http'
      throw new McpError(kind, `${message.method}: ${error.message}`)
    })
    stats.sessionId = response.headers.get('mcp-session-id') ?? stats.sessionId
    const text = await response.text()
    return { response, text }
  }

  return {
    transport: 'http',
    stats,
    async request(method, params = {}, timeoutMs = requestTimeoutMs) {
      const id = nextId++
      const { response, text } = await post({ jsonrpc: '2.0', id, method, params }, timeoutMs)
      if (!response.ok) throw new McpError('http', `${method}: HTTP ${response.status}`, { text })
      const type = response.headers.get('content-type') ?? ''
      const bodies = type.includes('text/event-stream') ? parseSse(text) : [text]
      for (const body of bodies) {
        let message
        try {
          message = JSON.parse(body)
        } catch {
          stats.pollutionBytes += Buffer.byteLength(body)
          continue
        }
        if (isJsonRpc(message) && message.id === id) {
          const bytes = Buffer.byteLength(body)
          if (message.error)
            throw new McpError('rpc', message.error.message, { ...message.error, bytes })
          if (method === 'initialize') protocolVersion = message.result?.protocolVersion ?? null
          return { result: message.result, bytes }
        }
      }
      throw new McpError('protocol', `${method}: no JSON-RPC response with id ${id}`, {
        text: text.slice(0, 300),
      })
    },
    notify(method, params = {}) {
      return post({ jsonrpc: '2.0', method, params }, requestTimeoutMs).catch(() => {})
    },
    async close() {},
  }
}

/** initialize + notifications/initialized. Returns the server's answer and the time it took. */
export async function initialize(session, timeoutMs) {
  const started = performance.now()
  const { result, bytes } = await session.request(
    'initialize',
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    timeoutMs
  )
  await session.notify('notifications/initialized')
  return { result, bytes, ms: performance.now() - started }
}

/** tools/list, following cursors. */
export async function listTools(session, timeoutMs) {
  const tools = []
  let cursor
  let bytes = 0
  do {
    const page = await session.request('tools/list', cursor ? { cursor } : {}, timeoutMs)
    bytes += page.bytes
    tools.push(...(page.result?.tools ?? []))
    cursor = page.result?.nextCursor
  } while (cursor)
  return { tools, bytes }
}

/** tools/call; a tool-level failure is a result with isError, not an exception. */
export async function callTool(session, name, args, timeoutMs) {
  const started = performance.now()
  const { result, bytes } = await session.request(
    'tools/call',
    { name, arguments: args },
    timeoutMs
  )
  return {
    isError: result?.isError === true,
    content: result?.content ?? [],
    structuredContent: result?.structuredContent,
    bytes,
    ms: performance.now() - started,
  }
}
