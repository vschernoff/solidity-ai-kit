#!/usr/bin/env node
// Renders a run-cases report as Markdown for the CI step summary.
//
//   node eval/scripts/cases-summary.mjs <cases.json> >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: cases-summary.mjs <cases.json>')
  process.exit(2)
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'))
const lines = [`### Cases: ${report.id}@${report.version ?? '?'} (${report.stage})`, '']
if (report.noCases) {
  lines.push(`No cases exist for stage \`${report.stage}\`: nothing was checked.`)
} else {
  lines.push(
    `**${report.passed} passed, ${report.failed} failed**`,
    '',
    '| Case | Result | Failed checks |',
    '|---|---|---|'
  )
  for (const r of report.results) {
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.check} (${c.detail})`)
    lines.push(
      `| ${r.id} | ${r.passed ? 'pass' : '**FAIL**'} | ${failed.join('; ').replaceAll('|', '\\|') || '—'} |`
    )
  }
}
process.stdout.write(`${lines.join('\n')}\n`)
