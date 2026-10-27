import { parseArgs } from 'node:util'
import { claudeCode, claudeCodeRemove } from './clients/claude-code.js'
import { codex, codexRemove } from './clients/codex.js'
import { cursor, cursorRemove } from './clients/cursor.js'
import { label, selectComponents } from './components.js'
import { detectProject } from './detect.js'
import { hardhatNotes } from './hardhat-notes.js'
import { DEFAULT_LIMITS, formatReport, runDoctor } from './doctor.js'
import { runInit } from './init.js'
import { runRemove } from './remove.js'
import { rulesGenerator, rulesRemover } from './rules.js'
import { loadManifest, readPackageJson } from './manifest.js'

// Clients init writes project-scoped config for.
export const CLIENTS = { 'claude-code': claudeCode, codex, cursor }
const REMOVERS = { 'claude-code': claudeCodeRemove, codex: codexRemove, cursor: cursorRemove }

const COMMANDS = {
  init: 'Preview (or with --write, apply) MCP configs and workflow rules for this project',
  doctor: 'Check the toolchain and that each enabled component starts',
  list: 'List the components in the manifest',
  remove: 'Preview (or with --write, apply) removal of what init wrote',
}

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length))
  const lines = Object.entries(COMMANDS).map(
    ([name, summary]) => `  ${name.padEnd(width)}  ${summary}`
  )
  return [
    'Usage: solidity-ai-kit <command> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    'Options:',
    '  --write          Apply the changes (init, remove). Without it, only preview them',
    `  --client <name>  ${Object.keys(CLIENTS).join(', ')} or all (default: all); repeatable`,
    '  --with <id>      Also install (init) or check (doctor) an opt-in component; repeatable',
    '  --limit c=n      doctor: warn when instructions exceed n chars for client c (default codex=512)',
    '  --timeout <s>    doctor: seconds to wait for each server to answer (default 30)',
    '  -h, --help       Show this help',
    '  -v, --version    Show the version',
  ].join('\n')
}

// Accepts both `--client a --client b` and `--client a,b`.
function listOption(values) {
  return (values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim())
}

function selectedClients(values) {
  const requested = listOption(values.client)
  const clients =
    requested.length === 0 || requested.includes('all') ? Object.keys(CLIENTS) : requested
  const unknown = clients.filter((client) => !Object.hasOwn(CLIENTS, client))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown client: ${unknown.join(', ')}. Known: ${Object.keys(CLIENTS).join(', ')}`
    )
  }
  return clients
}

// Every component the manifest lists, whether or not it was opted in: anything init could
// have written is removed.
function remove(values, { cwd, stdout, stderr, manifest = loadManifest() }) {
  const clients = selectedClients(values)
  return runRemove({
    root: cwd,
    write: values.write === true,
    components: manifest.components,
    removers: [...clients.map((client) => REMOVERS[client]), rulesRemover(clients)],
    stdout,
    stderr,
  })
}

function init(values, { cwd, stdout, stderr, manifest = loadManifest() }) {
  const clients = selectedClients(values)

  const project = detectProject(cwd)
  const components = selectComponents(manifest, listOption(values.with), project)
  if (components.length === 0) {
    const optIn = manifest.components.map(label).join(', ')
    stderr.write(
      `No components are enabled by default for this project. Opt in with --with <id> (available: ${optIn}).\n`
    )
  } else {
    stdout.write(`Components: ${components.map(label).join(', ')}\n`)
  }
  for (const note of hardhatNotes({ manifest, components, project, clients }))
    stdout.write(`Note: ${note}\n`)
  return runInit({
    root: cwd,
    write: values.write === true,
    components,
    generators: [...clients.map((client) => CLIENTS[client]), rulesGenerator(clients)],
    stdout,
    stderr,
  })
}

function parseLimits(values) {
  const limits = { ...DEFAULT_LIMITS }
  for (const entry of listOption(values)) {
    const match = entry.match(/^([a-z-]+)=(\d+)$/)
    if (!match || !Object.hasOwn(CLIENTS, match[1])) {
      throw new Error(`Bad --limit "${entry}"; use <client>=<chars>, e.g. codex=512`)
    }
    limits[match[1]] = Number(match[2])
  }
  return limits
}

async function doctor(values, { cwd, stdout, stderr, manifest }) {
  try {
    manifest ??= loadManifest()
    const seconds = values.timeout === undefined ? 30 : Number(values.timeout)
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new Error('--timeout must be a positive number')
    const requested = listOption(values.with)
    selectComponents(manifest, requested)
    const report = await runDoctor({
      root: cwd,
      manifest,
      engines: readPackageJson().engines.node,
      requested,
      limits: parseLimits(values.limit),
      timeoutMs: seconds * 1000,
    })
    const { text, ok } = formatReport(report)
    stdout.write(text)
    return ok ? 0 : 1
  } catch (error) {
    stderr.write(`solidity-ai-kit doctor: ${error.message}\n`)
    return 1
  }
}

// `manifest` replaces kit.manifest.json, for tests only.
export function main(
  argv,
  { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), manifest } = {}
) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        write: { type: 'boolean' },
        client: { type: 'string', multiple: true },
        with: { type: 'string', multiple: true },
        limit: { type: 'string', multiple: true },
        timeout: { type: 'string' },
      },
    })
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage()}\n`)
    return 2
  }

  const { values, positionals } = parsed
  if (values.version) {
    stdout.write(`${readPackageJson().version}\n`)
    return 0
  }
  const [command] = positionals
  if (values.help || command === undefined) {
    stdout.write(`${usage()}\n`)
    return 0
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    stderr.write(`Unknown command: ${command}\n\n${usage()}\n`)
    return 2
  }
  if (command === 'init') {
    try {
      return init(values, { cwd, stdout, stderr, manifest })
    } catch (error) {
      stderr.write(`solidity-ai-kit init: ${error.message}\n`)
      return 1
    }
  }
  if (command === 'remove') {
    try {
      return remove(values, { cwd, stdout, stderr, manifest })
    } catch (error) {
      stderr.write(`solidity-ai-kit remove: ${error.message}\n`)
      return 1
    }
  }
  if (command === 'doctor') {
    return doctor(values, { cwd, stdout, stderr, manifest })
  }
  // Commands land in their own pull requests. Until then, say so plainly and fail, so
  // nothing can mistake a no-op for a successful run.
  stderr.write(`solidity-ai-kit ${command}: not implemented yet\n`)
  return 1
}
