#!/usr/bin/env node
// Runs a stage's cases (eval/cases/<stage>.json) against one installed candidate. Each case gets
// a fresh copy of its fixture as the server's working directory, fresh marker files, and its own
// server process. Like probe.mjs: exit 0 whenever a report was written (failed cases are results),
// non-zero only if the harness itself failed. Meant to run in the no-network container (EVAL.yml).
//
//   node eval/scripts/run-cases.mjs <id> <install-dir> [--out file] [--candidate-file file]
//                                   [--timeout-ms n] [--cases file]   default eval/cases/<stage>.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { callTool, initialize, startStdio } from '../harness/mcp-client.js'
import { candidateEnv, candidateVersion, launchCommand, readCandidate } from '../lib/candidates.js'
import {
  evaluateCase,
  fillPlaceholders,
  markerPaths,
  plantMarkers,
  readCases,
  resultText,
} from '../lib/cases.js'
import { FIXTURES_DIR, flagValue } from '../lib/fixtures.js'

const args = process.argv.slice(2)
const [id, installDir] = args
let outFile, timeoutMs, candidateFile, casesFile
try {
  if (!id || id.startsWith('--') || !installDir || installDir.startsWith('--')) {
    throw new Error('usage: run-cases.mjs <id> <install-dir> [--out file] [--candidate-file file]')
  }
  outFile = flagValue(args, '--out')
  candidateFile = flagValue(args, '--candidate-file')
  casesFile = flagValue(args, '--cases')
  timeoutMs = Number(flagValue(args, '--timeout-ms', '60000'))
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
    throw new Error('--timeout-ms must be an integer of at least 100')
  }
} catch (error) {
  console.error(`run-cases: ${error.message}`)
  process.exit(2)
}

const candidate = candidateFile
  ? JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
  : readCandidate(id)
const cases = casesFile
  ? JSON.parse(fs.readFileSync(casesFile, 'utf8')).cases
  : readCases(candidate.stage)
if (!cases) {
  // Not an error: a stage without cases yet. Said explicitly in the report, never as a pass.
  const report = {
    id: candidate.id,
    stage: candidate.stage,
    noCases: true,
    passed: 0,
    failed: 0,
    results: [],
  }
  if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
  console.error(`run-cases: no cases for stage "${candidate.stage}" — nothing was checked`)
  process.exit(0)
}
const { command, args: argv } = launchCommand(candidate, path.resolve(installDir))

async function runCase(spec) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `sak-case-${spec.id}-`))
  const project = path.join(work, 'project')
  const home = path.join(work, 'home')
  fs.mkdirSync(home)
  fs.cpSync(path.join(FIXTURES_DIR, spec.fixture), project, { recursive: true })
  const markers = markerPaths(work, spec.id)
  plantMarkers(markers)
  const env = { ...candidateEnv(home), ...(spec.env ?? {}) }
  const session = startStdio({ command, args: argv, cwd: project, env })
  let call
  const started = performance.now()
  try {
    await initialize(session, timeoutMs)
    call = await callTool(
      session,
      spec.tool,
      fillPlaceholders(spec.args ?? {}, markers, project),
      timeoutMs
    )
  } catch (error) {
    call = { error: `${error.kind ?? 'harness'}: ${error.message}` }
  } finally {
    await session.close()
  }
  const markerFired = fs.existsSync(markers.fired)
  const verdict = evaluateCase(spec.expect, call, { markerFired })
  const text = call.error ? '' : resultText(call)
  fs.rmSync(work, { recursive: true, force: true })
  return {
    id: spec.id,
    fixture: spec.fixture,
    tool: spec.tool,
    env: spec.env ?? {},
    why: spec.why,
    passed: verdict.passed,
    checks: verdict.checks,
    isError: call.error ? null : call.isError,
    ms: Math.round(performance.now() - started),
    text: text.length > 1500 ? `${text.slice(0, 1500)}… [${text.length} chars]` : text,
    orphans: session.stats.orphans,
  }
}

const results = []
for (const spec of cases) {
  const result = await runCase(spec)
  results.push(result)
  console.error(`${result.passed ? 'pass' : 'FAIL'} ${result.id}`)
}

const report = {
  id: candidate.id,
  version: candidateVersion(candidate),
  stage: candidate.stage,
  ranAt: new Date().toISOString(),
  node: process.version,
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  results,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (outFile) fs.writeFileSync(outFile, json)
else process.stdout.write(json)
console.error(
  `run-cases: ${candidate.id}@${report.version}: ${report.passed} passed, ${report.failed} failed`
)
process.exit(0)
