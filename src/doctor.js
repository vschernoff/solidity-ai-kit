import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { MCP_FILE as CLAUDE_MCP_FILE } from './clients/claude-code.js'
import { CONFIG_FILE as CODEX_FILE } from './clients/codex.js'
import { MCP_FILE as CURSOR_MCP_FILE } from './clients/cursor.js'
import { readText } from './clients/json.js'
import { isDefaultFor, label, launchSpec } from './components.js'
import { detectProject } from './detect.js'
import { launchCommand, probe } from './mcp-probe.js'
import { NODE_INSTALL, meetsFloor } from './node-check.js'

// FR-10…FR-13. doctor only reads and runs; it never writes into the project, installs or
// upgrades anything (FR-13). The one directory it creates is a temporary one outside the
// project, for the second instructions measurement (FR-12), and it is removed afterwards.

export const STATUS = {
  healthy: 'healthy',
  missing: 'missing',
  wrongVersion: 'wrong version',
  failed: 'failed to start',
  notChecked: 'not checked',
  skipped: 'skipped',
}

const PROBLEMS = new Set([STATUS.missing, STATUS.wrongVersion, STATUS.failed, STATUS.notChecked])

// Client recommendations, not MCP limits (C2). Overridable with --limit <client>=<chars>.
export const DEFAULT_LIMITS = { codex: 512 }
const LIMIT_SOURCES = { codex: "Codex's guidance recommends" }

const CLIENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor' }

const FOUNDRY_INSTALL = 'https://getfoundry.sh/introduction/installation'

function runVersion(command, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: timeoutMs, shell: false }, (error, stdout) => {
      if (error?.code === 'ENOENT') resolve({ found: false })
      else if (error) resolve({ found: true, error: error.message.split('\n')[0] })
      else resolve({ found: true, version: stdout.trim().split('\n')[0] })
    })
  })
}

// Which kit components, and which clients, `init` configured here: read-only, from the
// clients' own files. An unreadable file is reported, never fatal.
export function configuredInProject(root, manifest) {
  const ids = new Set(manifest.components.map(({ id }) => id))
  const found = new Map()
  const unreadable = []
  const sources = [
    ['claude-code', CLAUDE_MCP_FILE, (text) => JSON.parse(text).mcpServers],
    ['cursor', CURSOR_MCP_FILE, (text) => JSON.parse(text).mcpServers],
    ['codex', CODEX_FILE, (text) => parseToml(text).mcp_servers],
  ]
  for (const [client, file, servers] of sources) {
    let text
    try {
      text = readText(root, file)
    } catch {
      unreadable.push(file)
      continue
    }
    if (text === null) continue
    let entries
    try {
      entries = servers(text) ?? {}
    } catch {
      unreadable.push(file)
      continue
    }
    for (const id of Object.keys(entries)) {
      if (!ids.has(id)) continue
      if (!found.has(id)) found.set(id, new Set())
      found.get(id).add(client)
    }
  }
  return { found, unreadable }
}

async function checkNode({ engines }) {
  const ok = meetsFloor(process.version, engines)
  return {
    name: 'Node',
    status: ok ? STATUS.healthy : STATUS.wrongVersion,
    detail: `${process.version} (needs ${engines})`,
    fix: ok ? null : `Install Node 22 or 24: ${NODE_INSTALL}`,
  }
}

// A component's supported range for a binary, from the manifest's binaryVersions:
// ">=1.8.5 <1.9.0". Read the way forge-test-mcp 0.1.0 reads `forge --version`
// ("forge Version: 1.8.6" or "forge 1.8.6-nightly (…)").
export function parseVersion(output) {
  const match =
    output.match(/Version:\s*v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/) ??
    output.match(/forge\s+v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/)
  if (!match) return null
  const [, major, minor, patch, prerelease] = match
  return { numbers: [major, minor, patch].map(Number), prerelease: prerelease ?? null }
}

// The schema allows only ">=x.y.z <x.y.z".
function parseRange(range) {
  const [min, max] = range.match(/\d+\.\d+\.\d+/g).map((v) => v.split('.').map(Number))
  return { min, maxExclusive: max }
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

// Matches forge-test-mcp 0.1.0: below the range it refuses to run (a problem here); above it,
// it runs and flags the results as untested (a warning here). A pre-release build is a warning
// too: the server may or may not accept it, depending on the commit it was built from.
export function assessVersion(output, range) {
  const version = parseVersion(output)
  if (version === null) return { status: 'unreadable' }
  const { min, maxExclusive } = parseRange(range)
  if (compare(version.numbers, min) < 0) return { status: 'too-old' }
  if (compare(version.numbers, maxExclusive) >= 0) return { status: 'newer' }
  if (version.prerelease) return { status: 'prerelease' }
  return { status: 'supported' }
}

function checkVersions(toolchain, components) {
  for (const component of components) {
    for (const [binary, { range, fix }] of Object.entries(component.binaryVersions ?? {})) {
      const check = toolchain.find(({ name }) => name === binary)
      if (check?.status !== STATUS.healthy) continue
      const needs = `${label(component)} supports ${range}`
      const { status } = assessVersion(check.detail, range)
      if (status === 'too-old' || status === 'unreadable') {
        check.status = STATUS.wrongVersion
        check.detail = `${check.detail} (${status === 'too-old' ? 'too old' : 'version not readable'}; ${needs})`
        check.fix = fix
      } else if (status === 'newer') {
        check.warnings = [
          ...(check.warnings ?? []),
          `newer than the range ${label(component)} is tested with (${range}); it runs but marks results as untested`,
        ]
      } else if (status === 'prerelease') {
        // forge-test-mcp accepts some pre-release builds (those built from a tested release's
        // commit, e.g. 1.8.6-dev) and not others; the first line of `--version` cannot tell which,
        // so say only what is known.
        check.warnings = [
          ...(check.warnings ?? []),
          `a pre-release build; ${label(component)} supports release builds ${range} and may treat this one as untested`,
        ]
      }
    }
  }
}

async function checkBinary(name, { required, fix, timeoutMs, runner }) {
  const result = await runner(name, { timeoutMs })
  if (!result.found) {
    return required
      ? { name, status: STATUS.missing, detail: 'not on PATH', fix }
      : { name, status: STATUS.skipped, detail: 'not on PATH; not needed for this project' }
  }
  if (result.error) return { name, status: STATUS.failed, detail: result.error, fix }
  return { name, status: STATUS.healthy, detail: result.version }
}

// When doctor itself runs under `npx` / `npm exec`, npm puts the details of that run in the
// environment (npm_config_package names the kit's own package). A server started from here
// through `npx` would inherit them and install the kit instead of the server. Those run-
// specific variables are removed; the user's own npm settings (registry, proxy, cache) stay.
const NPM_RUN_VARIABLES = /^npm_(config_package|config_call|command|lifecycle_.*|package_json)$/i

export function serverEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !NPM_RUN_VARIABLES.test(key)))
}

async function checkComponent(component, { root, deepDir, timeoutMs, prober }) {
  const name = label(component)
  const fix = component.package
    ? `Run \`npx -y ${component.package}@${component.version}\` in the project to see the error.`
    : `See ${component.source}.`
  if (component.transport !== 'stdio') {
    return {
      name,
      status: STATUS.notChecked,
      detail: `${component.transport} components are not checked yet; it was not contacted`,
      fix: `Start it and check ${component.url} yourself.`,
    }
  }
  const launch = launchCommand(launchSpec(component))
  if (launch === null) {
    return {
      name,
      status: STATUS.failed,
      detail: 'could not find npm’s npx-cli.js next to node',
      fix: 'Reinstall Node with npm included.',
    }
  }
  const env = serverEnvironment()
  const first = await prober({ ...launch, cwd: root, timeoutMs, env })
  if (first.status !== 'healthy') {
    return {
      name,
      status: first.status === 'missing' ? STATUS.missing : STATUS.failed,
      detail: first.reason,
      fix,
    }
  }
  const reported = first.serverInfo.version
  if (component.package && reported !== undefined && reported !== component.version) {
    return {
      name,
      status: STATUS.wrongVersion,
      detail: `reports ${reported}, manifest pins ${component.version}`,
      fix,
    }
  }
  // FR-12: the same server from a directory of different depth; a different length means
  // the text interpolates something machine-specific (usually a path).
  const second = await prober({ ...launch, cwd: deepDir, timeoutMs, env })
  const lengths = [{ dir: root, length: first.instructions.length }]
  if (second.status === 'healthy')
    lengths.push({ dir: deepDir, length: second.instructions.length })
  return {
    name,
    status: STATUS.healthy,
    detail: `${first.serverInfo.name} ${reported ?? '(no version reported)'}`,
    instructions: {
      lengths,
      variable: lengths.length === 2 && lengths[0].length !== lengths[1].length,
      secondRun: second.status === 'healthy' ? null : second.reason,
    },
  }
}

function instructionWarnings(check, clients, limits) {
  const warnings = []
  const longest = Math.max(...check.instructions.lengths.map(({ length }) => length))
  for (const client of clients) {
    const limit = limits[client]
    if (limit === undefined || longest <= limit) continue
    const source = LIMIT_SOURCES[client] ?? `the limit set for ${CLIENT_NAMES[client] ?? client}`
    warnings.push(
      `instructions are ${longest} chars, which exceeds the ~${limit} chars ${source} (${CLIENT_NAMES[client] ?? client})`
    )
  }
  return warnings
}

export async function runDoctor({
  root,
  manifest,
  engines,
  requested = [],
  limits = DEFAULT_LIMITS,
  timeoutMs = 30_000,
  // Where the second-measurement directory is made; a parameter so tests can watch it.
  tempRoot = os.tmpdir(),
  runner = runVersion,
  prober = probe,
}) {
  const project = detectProject(root)
  const { found, unreadable } = configuredInProject(project.root, manifest)

  // Components to check: those init configured here, plus any asked for with --with. With
  // neither, the manifest's defaults for this kind of project, as init would choose them.
  const ids = new Set([...found.keys(), ...requested])
  if (ids.size === 0) {
    for (const component of manifest.components)
      if (isDefaultFor(component, project)) ids.add(component.id)
  }
  const components = manifest.components.filter(({ id }) => ids.has(id))
  const clients = new Set([...found.values()].flatMap((set) => [...set]))

  // Each binary is checked once: required when the project or any checked component needs it.
  const foundry = project.kind === 'foundry' || project.kind === 'both'
  const binaries = new Map()
  for (const binary of ['forge', 'anvil', 'cast']) {
    binaries.set(binary, { required: foundry, fix: `Install Foundry: ${FOUNDRY_INSTALL}` })
  }
  for (const component of components) {
    for (const binary of component.requiresBinaries) {
      if (binaries.get(binary)?.required) continue
      binaries.set(binary, {
        required: true,
        fix: `Needed by ${label(component)}; see ${component.source}.`,
      })
    }
  }
  const toolchain = [await checkNode({ engines })]
  for (const [binary, { required, fix }] of binaries) {
    toolchain.push(await checkBinary(binary, { required, fix, timeoutMs, runner }))
  }
  checkVersions(toolchain, components)

  const leftovers = []
  const deepDir = fs.mkdtempSync(path.join(tempRoot, 'solidity-ai-kit-doctor-'))
  const nested = path.join(deepDir, 'a', 'deeper', 'working', 'directory')
  fs.mkdirSync(nested, { recursive: true })
  let checks
  try {
    checks = await Promise.all(
      components.map((component) =>
        checkComponent(component, { root: project.root, deepDir: nested, timeoutMs, prober })
      )
    )
  } finally {
    try {
      fs.rmSync(deepDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      leftovers.push(deepDir)
    }
  }
  for (const check of checks) {
    if (check.instructions) check.warnings = instructionWarnings(check, clients, limits)
  }

  return {
    project,
    toolchain,
    components: checks,
    clients: [...clients].sort(),
    unreadable,
    leftovers,
  }
}

export function formatReport(report) {
  const lines = [`Project: ${report.project.kind} at ${report.project.root}`, '', 'Toolchain']
  const row = ({ name, status, detail }) => `  ${status.padEnd(15)} ${name}: ${detail}`
  for (const check of report.toolchain) {
    lines.push(row(check))
    if (check.fix) lines.push(`                  → ${check.fix}`)
    for (const warning of check.warnings ?? [])
      lines.push(`  warning         ${check.name}: ${warning}`)
  }
  lines.push('', 'Components')
  if (report.components.length === 0) {
    lines.push('  none configured here; run `solidity-ai-kit init --with <id>` first')
  }
  for (const check of report.components) {
    lines.push(row(check))
    if (check.fix && check.status !== STATUS.healthy) lines.push(`                  → ${check.fix}`)
    if (check.instructions) {
      for (const { dir, length } of check.instructions.lengths) {
        lines.push(`                  instructions: ${length} chars from ${dir}`)
      }
      if (check.instructions.variable) {
        lines.push(
          '                  instructions are variable: their length depends on the directory'
        )
      }
      if (check.instructions.secondRun) {
        lines.push(`                  second measurement failed: ${check.instructions.secondRun}`)
      }
      for (const warning of check.warnings)
        lines.push(`  warning         ${check.name}: ${warning}`)
    }
  }
  for (const dir of report.leftovers ?? []) {
    lines.push(
      `  warning         could not remove the temporary directory ${dir}; delete it by hand`
    )
  }
  for (const file of report.unreadable) {
    lines.push(`  warning         ${file} could not be read; its servers were not checked`)
  }

  const problems = [...report.toolchain, ...report.components].filter(({ status }) =>
    PROBLEMS.has(status)
  )
  lines.push(
    '',
    problems.length === 0
      ? 'All checks passed.'
      : `${problems.length} problem(s); see the → lines above.`
  )
  return {
    text: `${lines.join('\n')}\n`,
    ok: problems.length === 0 && report.unreadable.length === 0,
  }
}
