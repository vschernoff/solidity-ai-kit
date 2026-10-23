#!/usr/bin/env node
// Renders a probe report as Markdown for the CI step summary.
//
//   node eval/scripts/probe-summary.mjs <probe.json> >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: probe-summary.mjs <probe.json>')
  process.exit(2)
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'))
const { probe } = report
const lines = [
  `### Probe: ${report.id}@${report.version}`,
  '',
  `- Healthy: **${probe.healthy ? 'yes' : 'no'}**`,
  `- Tools: ${probe.toolCount ?? 'none listed'}`,
  `- Instructions: ${probe.instructions.chars.join(' / ')} chars` +
    (probe.instructions.variable ? ' (varies with the working directory)' : ''),
  `- Non-protocol bytes on stdout: ${probe.stdoutPollutionBytes}`,
  `- Files written to HOME: ${report.homeWrites.length ? report.homeWrites.join(', ') : 'none'}`,
  '',
]
if (report.findings.length) {
  lines.push('| Gate | Severity | Finding |', '|---|---|---|')
  for (const f of report.findings) {
    lines.push(`| ${f.gate} | ${f.severity ?? 'finding'} | ${f.finding.replaceAll('|', '\\|')} |`)
  }
} else {
  lines.push('No findings.')
}
process.stdout.write(`${lines.join('\n')}\n`)
