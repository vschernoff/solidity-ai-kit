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
  CANARIES,
  candidateEnv,
  candidateVersion,
  launchCommand,
  probeFindings,
  readCandidate,
} from '../lib/candidates.js'
import { flagValue } from '../lib/fixtures.js'
import { probeServer } from '../harness/probe.js'

const args = process.argv.slice(2)
const [id, installDir] = args
let outFile, timeoutMs, candidateFile
try {
  if (!id || id.startsWith('--') || !installDir || installDir.startsWith('--')) {
    throw new Error(
      'usage: probe.mjs <id> <install-dir> [--out file] [--candidate-file file] [--timeout-ms n]'
    )
  }
  outFile = flagValue(args, '--out')
  candidateFile = flagValue(args, '--candidate-file')
  timeoutMs = Number(flagValue(args, '--timeout-ms', '20000'))
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
    throw new Error('--timeout-ms must be an integer of at least 100')
  }
} catch (error) {
  console.error(`probe: ${error.message}`)
  process.exit(2)
}

const candidate = candidateFile
  ? JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
  : readCandidate(id)
const home = fs.mkdtempSync(path.join(os.tmpdir(), `sak-home-${id}-`))
const { command, args: argv } = launchCommand(candidate, path.resolve(installDir))
const result = await probeServer(
  { id, transport: candidate.transport, command, args: argv, env: candidateEnv(home) },
  { timeouts: { initializeMs: timeoutMs, toolsListMs: timeoutMs }, secrets: CANARIES }
)
const findings = probeFindings(result, candidate)
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
