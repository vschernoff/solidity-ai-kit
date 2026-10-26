// Stage cases: tool calls against a fixture, each with expectations any implementation of the
// stage must meet. Pure helpers here; scripts/run-cases.mjs runs them against a real server.
import fs from 'node:fs'
import path from 'node:path'
import { EVAL_ROOT, readJson } from './fixtures.js'

export const CASES_DIR = path.join(EVAL_ROOT, 'cases')

export function readCases(stage) {
  return readCaseFile(stage)?.cases ?? null
}

/** The whole cases file of a stage (cases plus shared settings such as `env`), or null. */
export function readCaseFile(stage) {
  const file = path.join(CASES_DIR, `${stage}.json`)
  return fs.existsSync(file) ? readJson(file) : null
}

/**
 * A case's environment: the file's shared `env`, then the case's own. A value written as
 * `$ENV:NAME` is taken from the harness's environment (`source`), e.g. the path of a toolchain
 * binary that differs between CI and a laptop. A missing one is an error, never an empty value.
 */
export function resolveEnv(shared = {}, own = {}, source = process.env) {
  const env = { ...shared, ...own }
  for (const [name, value] of Object.entries(env)) {
    const ref = typeof value === 'string' && value.match(/^\$ENV:([A-Za-z_][A-Za-z0-9_]*)$/)
    if (!ref) continue
    if (!source[ref[1]]) throw new Error(`${name} needs ${ref[1]} in the harness environment`)
    env[name] = source[ref[1]]
  }
  return env
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

/** A case pattern: a JS regular expression source, `(?i)` prefix for case-insensitive. */
export function toRegExp(source) {
  return source.startsWith('(?i)') ? new RegExp(source.slice(4), 'i') : new RegExp(source)
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
export function evaluateCase(
  expect,
  call,
  {
    markerFired = false,
    pollutionBytes = 0,
    orphans = false,
    presentFiles = [],
    groundTruth = null,
  } = {}
) {
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
  for (const source of expect.matches ?? []) {
    const hit = toRegExp(source).test(text)
    add(`matches /${source}/`, hit, hit ? 'matched' : 'no line matched')
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
  if (expect.maxTextBytes !== undefined) {
    const bytes = Buffer.byteLength(text)
    add(
      `result text ≤ ${expect.maxTextBytes} bytes`,
      bytes <= expect.maxTextBytes,
      `${bytes} bytes`
    )
  }
  for (const file of expect.filesAbsent ?? []) {
    const present = presentFiles.includes(file)
    add(`project has no ${file} afterwards`, !present, present ? 'created' : 'absent')
  }
  if (expect.noOrphans) {
    add('no process outlives the server', !orphans, orphans ? 'orphans left' : 'none')
  }
  if (expect.groundTruth) checkGroundTruth(expect.groundTruth, groundTruth, text, add)
  return { passed: checks.every((c) => c.ok), checks }
}

/** Every object in a parsed JSON value, depth first. */
function objectsIn(value, out = []) {
  if (Array.isArray(value)) for (const item of value) objectsIn(item, out)
  else if (value && typeof value === 'object') {
    out.push(value)
    for (const item of Object.values(value)) objectsIn(item, out)
  }
  return out
}

/** Every string and number anywhere in a value, as strings. */
function leavesOf(value, out = []) {
  if (Array.isArray(value)) for (const item of value) leavesOf(item, out)
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) leavesOf(v, out)
  else if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
  return out
}

/**
 * Checks a test-stage result against the fixture's GROUND_TRUTH.json `expect.test`, without
 * relying on field names beyond `passed`/`failed` counts: a failing test is found as an object
 * whose values name the test, contain its reason and, if given, equal its kind.
 * `spec.failures`: "all" checks each failing test; "none" checks the counts only (a result
 * over its size budget may leave failures out, and must say so).
 */
function checkGroundTruth(spec, truth, text, add) {
  if (!truth?.failing && !truth?.passing) {
    add('ground truth', false, 'the fixture has no passing/failing test lists')
    return
  }
  let result
  try {
    result = JSON.parse(text)
  } catch {
    add('result is JSON', false, 'not JSON')
    return
  }
  const passing = truth.passing ?? []
  const failing = truth.failing ?? []
  const objects = objectsIn(result)
  const counts = objects.some((o) => o.passed === passing.length && o.failed === failing.length)
  add(
    `reports ${passing.length} passed, ${failing.length} failed`,
    counts,
    counts ? 'found' : 'no object with those counts'
  )
  if (spec.failures === 'none') return
  for (const f of failing) {
    const id = `${f.contract}.${f.test}`
    const match = objects.find((o) => {
      const own = Object.values(o).filter((v) => typeof v === 'string')
      return (
        own.some((v) => v.includes(id)) &&
        own.some((v) => v.includes(f.reasonContains)) &&
        (!f.kind || own.includes(f.kind))
      )
    })
    add(
      `${id}: ${f.kind ?? 'failure'} with "${f.reasonContains}"`,
      Boolean(match),
      match ? 'found' : 'no failure object names it with that reason and kind'
    )
    if (!match) continue
    if (f.counterexample?.gte !== undefined) {
      const min = BigInt(f.counterexample.gte)
      const numbers = leavesOf(match)
        .flatMap((s) => s.match(/\b\d+\b/g) ?? [])
        .map((d) => BigInt(d))
      const ok = numbers.some((n) => n >= min)
      add(`${id}: a counterexample value ≥ ${f.counterexample.gte}`, ok, ok ? 'found' : 'none')
    }
    if (f.sequence?.containsInOrder) {
      const flat = JSON.stringify(match)
      let at = 0
      const ok = f.sequence.containsInOrder.every((call) => {
        const index = flat.indexOf(call, at)
        if (index === -1) return false
        at = index + call.length
        return true
      })
      add(
        `${id}: call sequence ${f.sequence.containsInOrder.join(' → ')}`,
        ok,
        ok ? 'in order' : 'missing or out of order'
      )
    }
  }
  for (const id of passing) {
    const listed = objects.some((o) =>
      Object.values(o).some((v) => typeof v === 'string' && v === id)
    )
    add(`${id} is not reported as failing`, !listed, listed ? 'listed' : 'not listed')
  }
}
