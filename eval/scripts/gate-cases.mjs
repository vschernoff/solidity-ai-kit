#!/usr/bin/env node
// Turns a run-cases report into a pass/fail for CI. run-cases.mjs exits 0 whenever it wrote a
// report (a failed case is a result); this step makes the job fail unless the failed cases are
// exactly the ones the candidate file declares in `expectedFailures`, each with a reason. An
// expected failure that now passes also fails the gate, so the list cannot go stale.
//
//   node eval/scripts/gate-cases.mjs <cases.json> [--candidate-file file]
import fs from 'node:fs'
import { readCandidate } from '../lib/candidates.js'
import { flagValue } from '../lib/fixtures.js'

const args = process.argv.slice(2)
let report, candidate
try {
  if (!args[0] || args[0].startsWith('--')) {
    throw new Error('usage: gate-cases.mjs <cases.json> [--candidate-file file]')
  }
  report = JSON.parse(fs.readFileSync(args[0], 'utf8'))
  const candidateFile = flagValue(args, '--candidate-file')
  candidate = candidateFile
    ? JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
    : readCandidate(report.id)
} catch (error) {
  console.error(`gate-cases: ${error.message}`)
  process.exit(2)
}

const expected = new Map((candidate.expectedFailures ?? []).map((e) => [e.case, e.why]))
const failed = report.results.filter((r) => !r.passed).map((r) => r.id)
const problems = []
if (report.noCases || report.results.length === 0) problems.push('no case was run')
for (const id of failed) {
  if (!expected.has(id)) problems.push(`${id} failed`)
}
for (const id of expected.keys()) {
  if (!failed.includes(id)) problems.push(`${id} is listed in expectedFailures but did not fail`)
}

const tally = `${report.passed} passed, ${report.failed} failed, ${expected.size} expected to fail`
if (problems.length) {
  console.error(`gate-cases: ${report.id}@${report.version}: ${tally}`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.error(`gate-cases: ${report.id}@${report.version}: ${tally}: ok`)
