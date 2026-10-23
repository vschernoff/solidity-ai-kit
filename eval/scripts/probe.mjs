#!/usr/bin/env node
// Probes one installed candidate: handshake from two working directories, live
// `instructions` length, tools/list snapshot, stdout pollution, canary leaks, deny-list check.
// Exit 0 whenever a report was written (findings are in it); non-zero only if the harness
// itself failed. Meant to run inside a container with no network (EVAL.yml), on a read-only install.
//
//   node eval/scripts/probe.mjs <id> <install-dir> [--out file] [--candidate-file file]
//                                [--timeout-ms n]   per-request timeout (default 20000)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  candidateEnv,
  candidateVersion,
  launchCommand,
  leakedCanaries,
  readCandidate,
} from '../lib/candidates.js'
import { probeServer, staleDenials } from '../harness/probe.js'

const args = process.argv.slice(2)
const [id, installDir] = args
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
if (!id || !installDir) {
  console.error('usage: probe.mjs <id> <install-dir> [--out file]')
  process.exit(2)
}

const timeoutMs = args.includes('--timeout-ms')
  ? Number(args[args.indexOf('--timeout-ms') + 1])
  : 20_000
const candidateFile = args.includes('--candidate-file')
  ? args[args.indexOf('--candidate-file') + 1]
  : null
const candidate = candidateFile
  ? JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
  : readCandidate(id)
const home = fs.mkdtempSync(path.join(os.tmpdir(), `sak-home-${id}-`))
const { command, args: argv } = launchCommand(candidate, path.resolve(installDir))
const result = await probeServer(
  {
    id,
    transport: candidate.transport,
    command,
    args: argv,
    env: candidateEnv(home),
  },
  { timeouts: { initializeMs: timeoutMs, toolsListMs: timeoutMs } }
)

const findings = []
const leaks = leakedCanaries(JSON.stringify(result))
if (leaks.length) findings.push({ gate: 'G7', finding: `canary leaked: ${leaks.join(', ')}` })
if (result.stdoutPollutionBytes) {
  findings.push({
    gate: 'C3',
    finding: `${result.stdoutPollutionBytes} non-protocol bytes on stdout`,
  })
}
for (const error of result.errors) {
  findings.push({ gate: 'C4', finding: `${error.step} failed (${error.kind}): ${error.message}` })
}
if (result.instructions.variable) {
  findings.push({ gate: 'C2', finding: `instructions vary with cwd: ${result.instructions.chars}` })
}
if (result.tools) {
  const stale = staleDenials(Object.keys(result.tools), candidate.deniedTools)
  if (stale.length) findings.push({ gate: 'FR-7', finding: `deniedTools not exposed: ${stale}` })
}
const homeWrites = fs.readdirSync(home, { recursive: true })
fs.rmSync(home, { recursive: true, force: true })

const report = {
  id,
  version: candidateVersion(candidate),
  probedAt: new Date().toISOString(),
  node: process.version,
  probe: result,
  homeWrites,
  findings,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (outFile) fs.writeFileSync(outFile, json)
else process.stdout.write(json)

console.error(
  `probe: ${id}@${report.version}: ${result.toolCount ?? 'no'} tools, instructions ` +
    `${result.instructions.chars.join('/')} chars, ${findings.length} finding(s)`
)
for (const f of findings) console.error(`  [${f.gate}] ${f.finding}`)
// The report is the result: an unhealthy candidate is a finding, not a harness failure.
process.exit(0)
