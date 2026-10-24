// Stage cases: tool calls against a fixture, each with expectations any implementation of the
// stage must meet. Pure helpers here; scripts/run-cases.mjs runs them against a real server.
import fs from 'node:fs'
import path from 'node:path'
import { EVAL_ROOT, readJson } from './fixtures.js'

export const CASES_DIR = path.join(EVAL_ROOT, 'cases')

export function readCases(stage) {
  const file = path.join(CASES_DIR, `${stage}.json`)
  return fs.existsSync(file) ? readJson(file).cases : null
}

/** Marker files for one case: a module that writes `fired` when it is loaded. */
export function markerPaths(workDir, caseId) {
  const dir = path.join(workDir, 'markers')
  return {
    dir,
    js: path.join(dir, `${caseId}.js`),
    plugin: path.join(dir, 'node_modules', 'solhint-plugin-marker', 'index.js'),
    fired: path.join(dir, `${caseId}.fired`),
  }
}

/** Write the marker modules. Loading either of them as code writes the `fired` file. */
export function plantMarkers(markers) {
  const body = `require('node:fs').writeFileSync(${JSON.stringify(markers.fired)}, 'fired')\n`
  fs.mkdirSync(path.dirname(markers.plugin), { recursive: true })
  fs.writeFileSync(markers.js, `${body}module.exports = { rules: {} }\n`)
  fs.writeFileSync(markers.plugin, `${body}module.exports = []\n`)
}

/** Replace $MARKER_JS / $MARKER_REL / $MARKER_DIR anywhere in the case arguments. */
export function fillPlaceholders(args, markers, projectDir) {
  const rel = path.relative(projectDir, markers.js)
  const json = JSON.stringify(args)
    .replaceAll('$MARKER_JS', markers.js)
    .replaceAll('$MARKER_REL', rel.startsWith('.') ? rel : `./${rel}`)
    .replaceAll('$MARKER_DIR', markers.dir)
  return JSON.parse(json)
}

/** All text a tool returned, joined. */
export function resultText(call) {
  return (call?.content ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * Check one call against a case's `expect`. `call` is { isError, content } or { error } when
 * the call itself failed (timeout, crash), which never satisfies an expectation.
 */
export function evaluateCase(expect, call, { markerFired = false, pollutionBytes = 0 } = {}) {
  const checks = []
  const add = (check, ok, detail) => checks.push({ check, ok, detail })
  if (call.error) {
    add('call', false, `tool call failed: ${call.error}`)
    if (expect.markerAbsent)
      add('marker absent', !markerFired, markerFired ? 'marker written' : 'not written')
    return { passed: false, checks }
  }
  const text = resultText(call)
  if (expect.isError !== undefined) {
    add(`isError is ${expect.isError}`, call.isError === expect.isError, `isError: ${call.isError}`)
  }
  for (const needle of expect.includes ?? []) {
    add(`mentions "${needle}"`, text.includes(needle), text.includes(needle) ? 'found' : 'absent')
  }
  for (const needle of expect.excludes ?? []) {
    add(
      `does not say "${needle}"`,
      !text.includes(needle),
      text.includes(needle) ? 'present' : 'absent'
    )
  }
  if (expect.stdoutClean) {
    add('nothing but JSON-RPC on stdout', pollutionBytes === 0, `${pollutionBytes} stray bytes`)
  }
  if (expect.markerAbsent) {
    add(
      'marker absent (no code loaded)',
      !markerFired,
      markerFired ? 'marker written' : 'not written'
    )
  }
  return { passed: checks.every((c) => c.ok), checks }
}
