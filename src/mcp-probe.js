import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

// Starts a stdio MCP server and completes the `initialize` handshake (FR-10). Every way it
// can go wrong is reported as such, never as healthy (C4): a missing executable, a crash,
// a timeout, an error response, or anything on stdout that is not a protocol message (C3:
// one stray line there corrupts a client's session).

export const PROTOCOL_VERSION = '2025-11-25'
const GRACE_MS = 2000

// On Windows `npx` is a .cmd script, which Node only runs through a shell. The kit never
// uses a shell (NFR-4), so it runs npm's own npx-cli.js with the current Node instead.
export function resolveNpx({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command: 'npx', prefix: [] }
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  if (env.npm_execpath) candidates.push(path.join(path.dirname(env.npm_execpath), 'npx-cli.js'))
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  return found ? { command: process.execPath, prefix: [found] } : null
}

export function launchCommand(spec) {
  if (spec.command !== 'npx') return { command: spec.command, args: spec.args }
  const npx = resolveNpx()
  if (npx === null) return null
  return { command: npx.command, args: [...npx.prefix, ...spec.args] }
}

export function probe({ command, args, cwd, timeoutMs, env = process.env }) {
  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    const noise = []
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })

    function stop() {
      child.stdin.end()
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill()
      }, GRACE_MS)
      timer.unref()
      child.once('exit', () => clearTimeout(timer))
    }

    function finish(result) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      stop()
      resolve({ pid: child.pid, stderr: stderr.slice(-2000), ...result })
    }

    const timeout = setTimeout(
      () =>
        finish({ status: 'failed', reason: `no initialize response within ${timeoutMs / 1000} s` }),
      timeoutMs
    )

    child.on('error', (error) => {
      if (error.code === 'ENOENT') finish({ status: 'missing', reason: `${command} not found` })
      else finish({ status: 'failed', reason: error.message })
    })
    child.on('exit', (code, signal) => {
      finish({ status: 'failed', reason: `exited before answering (${signal ?? `code ${code}`})` })
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdin.on('error', () => {
      // The child may exit before reading; the exit handler reports it.
    })

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.trim() === '') return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        noise.push(line.slice(0, 200))
        return
      }
      if (message?.id !== 1) return
      if (noise.length > 0) {
        finish({ status: 'failed', reason: 'wrote non-protocol output to stdout', noise })
      } else if (message.error) {
        finish({
          status: 'failed',
          reason: `initialize error: ${message.error.message ?? 'unknown'}`,
        })
      } else if (!message.result?.serverInfo) {
        finish({ status: 'failed', reason: 'initialize response has no serverInfo' })
      } else {
        finish({
          status: 'healthy',
          serverInfo: message.result.serverInfo,
          instructions: message.result.instructions ?? '',
        })
      }
    })

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'solidity-ai-kit-doctor', version: '0' },
        },
      })}\n`
    )
  })
}
