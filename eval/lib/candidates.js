import fs from 'node:fs'
import path from 'node:path'
import { staleDenials } from '../harness/probe.js'
import { EVAL_ROOT, readJson } from './fixtures.js'

export const CANDIDATES_DIR = path.join(EVAL_ROOT, 'candidates')

export function listCandidates() {
  return fs
    .readdirSync(CANDIDATES_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'candidate.schema.json')
    .map((file) => readJson(path.join(CANDIDATES_DIR, file)))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function readCandidate(id) {
  const candidate = listCandidates().find((c) => c.id === id)
  if (!candidate) throw new Error(`no candidate "${id}" in ${CANDIDATES_DIR}`)
  return candidate
}

export function candidateVersion({ install }) {
  return install.type === 'npm' ? install.version : install.tag
}

/**
 * Unique fake secrets put in the candidate's environment. Any of them showing up in a
 * response, in stderr or in egress means the server reads and leaks keys (eval-design §2).
 */
export const CANARIES = {
  PRIVATE_KEY: '0xc0ffee000000000000000000000000000000000000000000000000000000ca5a',
  ETHERSCAN_API_KEY: 'SAKCANARYETHERSCANKEY0000000000000',
  RPC_URL: 'http://sak-canary-rpc.invalid:8545',
}

/** Allow-listed environment for a candidate process: PATH, a temp HOME, canaries. */
export function candidateEnv(home) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    NO_COLOR: '1',
    CI: '1',
    ...CANARIES,
  }
}

/** Where the installed candidate's executable lives inside its install directory. */
export function launchCommand(candidate, installDir) {
  const { install } = candidate
  if (install.type === 'npm') {
    const pkgDir = path.join(installDir, 'node_modules', ...install.package.split('/'))
    const pkg = readJson(path.join(pkgDir, 'package.json'))
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[install.bin]
    if (!bin) throw new Error(`${install.package} has no bin "${install.bin}"`)
    return { command: process.execPath, args: [path.join(pkgDir, bin), ...candidate.args] }
  }
  if (install.type === 'python-git') {
    return { command: path.join(installDir, 'bin', install.bin), args: [...candidate.args] }
  }
  throw new Error(`unknown install type ${install.type}`)
}

/**
 * Instruction lengths client guidance recommends (SRS C2, FR-12). 512 is Codex's guidance to keep
 * the first ~512 chars self-contained: a recommendation, not a documented cut-off, and not an
 * MCP limit.
 */
export const INSTRUCTION_LIMITS = { Codex: 512 }

/** Findings from a probe result, one per gate problem. Warnings are labelled as such. */
export function probeFindings(result, candidate) {
  const findings = []
  const seen = new Set()
  for (const { name, where } of result.leaks ?? []) {
    if (seen.has(`${name}@${where}`)) continue
    seen.add(`${name}@${where}`)
    findings.push({ gate: 'G7', finding: `canary ${name} found in ${where}` })
  }
  if (result.stdoutPollutionBytes) {
    findings.push({
      gate: 'C3',
      finding: `${result.stdoutPollutionBytes} non-protocol bytes on stdout`,
    })
  }
  for (const error of result.errors ?? []) {
    findings.push({ gate: 'C4', finding: `${error.step} failed (${error.kind}): ${error.message}` })
  }
  const chars = (result.instructions?.chars ?? []).filter((n) => n !== null)
  if (result.instructions?.variable) {
    findings.push({
      gate: 'C2',
      severity: 'warning',
      finding: `instructions vary with the working directory: ${chars.join(' / ')} chars`,
    })
  }
  const longest = Math.max(0, ...chars)
  for (const [client, limit] of Object.entries(INSTRUCTION_LIMITS)) {
    if (longest > limit) {
      findings.push({
        gate: 'C2',
        severity: 'warning',
        finding: `instructions are ${longest} chars: exceeds the ~${limit} chars ${client}'s guidance recommends`,
      })
    }
  }
  if (result.tools) {
    const stale = staleDenials(Object.keys(result.tools), candidate.deniedTools)
    if (stale.length) findings.push({ gate: 'FR-7', finding: `deniedTools not exposed: ${stale}` })
  }
  return findings
}

// Hooks npm runs when a package is installed from the registry. `prepare` is not one of them
// (it runs for git dependencies and local installs only), so it is not counted.
const LIFECYCLE = ['preinstall', 'install', 'postinstall']

/** Every package.json under node_modules that declares a lifecycle script. */
export function lifecycleScripts(nodeModules) {
  const found = []
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (entry.name.startsWith('@')) {
        visit(full)
        continue
      }
      const manifest = path.join(full, 'package.json')
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        const scripts = LIFECYCLE.filter((name) => pkg.scripts?.[name])
        const gyp = fs.existsSync(path.join(full, 'binding.gyp'))
        if (scripts.length || gyp) {
          found.push({ package: `${pkg.name}@${pkg.version}`, scripts, bindingGyp: gyp })
        }
      }
      visit(path.join(full, 'node_modules'))
    }
  }
  visit(nodeModules)
  return found
}
