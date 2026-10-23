// Handshake and tool-surface probe (eval-design §3 steps 1, 2 and 6). For one candidate:
// initialize from two working directories of different depth, measure `instructions` live,
// snapshot tools/list, and count stdout pollution. Every failure is recorded, never dropped.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpError, connectHttp, initialize, listTools, startStdio } from './mcp-client.js'

export const DEFAULT_TIMEOUTS = { initializeMs: 20_000, toolsListMs: 20_000 }

/** Length in Unicode code points — what a person or client counts as characters. */
export function charLength(text) {
  return [...(text ?? '')].length
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Stable, comparable summary of a tools/list answer. */
export function toolSnapshot(tools) {
  return Object.fromEntries(
    [...tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => [
        tool.name,
        {
          descriptionSha256: sha256(tool.description ?? ''),
          inputSchemaSha256: sha256(tool.inputSchema ?? {}),
          annotations: tool.annotations ?? {},
        },
      ])
  )
}

/** What changed between two snapshots. Any added tool needs review before scores are reused. */
export function diffSnapshots(previous, current) {
  const before = new Set(Object.keys(previous ?? {}))
  const after = new Set(Object.keys(current ?? {}))
  return {
    added: [...after].filter((name) => !before.has(name)).sort(),
    removed: [...before].filter((name) => !after.has(name)).sort(),
    changed: [...after]
      .filter((name) => before.has(name))
      .filter((name) => JSON.stringify(previous[name]) !== JSON.stringify(current[name]))
      .sort(),
  }
}

/** deniedTools that the server does not expose: a stale deny-list protects nothing (FR-7). */
export function staleDenials(toolNames, deniedTools) {
  const names = new Set(toolNames)
  return deniedTools.filter((tool) => !names.has(tool))
}

function errorRecord(step, error) {
  return {
    step,
    kind: error instanceof McpError ? error.kind : 'harness',
    message: String(error?.message ?? error),
  }
}

/** Every place a secret could surface, by name, with the raw text the server produced there. */
function rawOutputs(record, session) {
  return {
    initialize: record.initializeRaw ?? '',
    'tools/list': record.tools ? JSON.stringify(record.tools) : '',
    stderr: session.stats.stderr ?? '',
    stdout: session.stats.pollutionText ?? '',
  }
}

/** [{ name, where }] for every secret value found in any raw output. */
export function findSecrets(outputs, secrets) {
  const found = []
  for (const [where, text] of Object.entries(outputs)) {
    for (const [name, value] of Object.entries(secrets)) {
      if (value && String(text).includes(value)) found.push({ name, where })
    }
  }
  return found
}

async function oneHandshake(spec, cwd, timeouts, secrets) {
  const session =
    spec.transport === 'http'
      ? connectHttp({ url: spec.url, headers: spec.headers })
      : startStdio({ command: spec.command, args: spec.args, cwd, env: spec.env })
  const record = { cwd, errors: [] }
  try {
    const init = await initialize(session, timeouts.initializeMs)
    record.initializeRaw = JSON.stringify(init.result ?? null)
    record.serverInfo = init.result?.serverInfo ?? null
    record.protocolVersion = init.result?.protocolVersion ?? null
    record.instructions = init.result?.instructions ?? null
    record.instructionsChars = charLength(record.instructions)
    record.initializeMs = Math.round(init.ms)
    try {
      const listed = await listTools(session, timeouts.toolsListMs)
      record.tools = listed.tools
      record.toolsListBytes = listed.bytes
    } catch (error) {
      // initialize answered but tools/list did not: looks connected, does nothing (C4).
      record.errors.push(errorRecord('tools/list', error))
    }
  } catch (error) {
    record.errors.push(errorRecord('initialize', error))
  } finally {
    await session.close()
  }
  record.stdoutPollutionBytes = session.stats.pollutionBytes
  record.stdoutPollutionSamples = session.stats.pollutionSamples
  record.stderrTail = (session.stats.stderr ?? '').slice(-2000)
  // Scanned here, against the full raw text, not against the summarised result.
  record.leaks = findSecrets(rawOutputs(record, session), secrets).map((l) => ({ ...l, cwd }))
  delete record.initializeRaw
  return record
}

/**
 * Probe one candidate. `spec`: { transport: 'stdio', command, args, env } or
 * { transport: 'http', url }. Stdio servers start once in a shallow and once in a deep
 * temporary directory, so path-interpolated instructions show up as `variable`. `secrets`
 * ({ NAME: value }) are searched for in every raw output: initialize, tools/list (descriptions
 * and schemas included), all of stderr, and stray stdout.
 */
export async function probeServer(
  spec,
  { timeouts = DEFAULT_TIMEOUTS, workRoot, secrets = {} } = {}
) {
  const root = workRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sak-probe-'))
  const shallow = path.join(root, 'p')
  const deep = path.join(shallow, 'nested', 'deeper', 'project', 'dir')
  fs.mkdirSync(deep, { recursive: true })
  try {
    const cwds = spec.transport === 'http' ? [shallow] : [shallow, deep]
    const handshakes = []
    for (const cwd of cwds) handshakes.push(await oneHandshake(spec, cwd, timeouts, secrets))

    const lengths = handshakes.map((h) => h.instructionsChars ?? null)
    const firstTools = handshakes.find((h) => h.tools)?.tools ?? null
    return {
      id: spec.id,
      transport: spec.transport,
      serverInfo: handshakes[0].serverInfo ?? null,
      protocolVersion: handshakes[0].protocolVersion ?? null,
      instructions: {
        chars: lengths,
        variable: new Set(lengths).size > 1,
        text: handshakes.map((h) => h.instructions),
      },
      initializeMs: handshakes.map((h) => h.initializeMs ?? null),
      tools: firstTools ? toolSnapshot(firstTools) : null,
      toolCount: firstTools?.length ?? null,
      toolsListBytes: handshakes.find((h) => h.tools)?.toolsListBytes ?? null,
      // Raw answers and stderr, kept so later checks (canary scan, G7) see every byte the
      // server produced, not only the hashed snapshot.
      toolsRaw: firstTools,
      stderrTails: handshakes.map((h) => h.stderrTail),
      leaks: handshakes.flatMap((h) => h.leaks),
      stdoutPollutionBytes: handshakes.reduce((sum, h) => sum + h.stdoutPollutionBytes, 0),
      stdoutPollutionSamples: handshakes.flatMap((h) => h.stdoutPollutionSamples),
      errors: handshakes.flatMap((h) => h.errors.map((e) => ({ ...e, cwd: h.cwd }))),
      healthy: handshakes.every((h) => h.errors.length === 0 && h.stdoutPollutionBytes === 0),
    }
  } finally {
    if (!workRoot) fs.rmSync(root, { recursive: true, force: true })
  }
}
