// Compares forge's JSON output with a fixture's GROUND_TRUTH.json. Pure functions: the script
// that runs forge (scripts/confirm-ground-truth.mjs) feeds them, the tests feed them samples.
//
// Rule (SRS C4): output we cannot parse is a mismatch with the reason attached, never a pass.

import fs from 'node:fs'
import path from 'node:path'

const KINDS = { Unit: 'unit', Fuzz: 'fuzz', Invariant: 'invariant' }

export function confirmed(check, detail = '') {
  return { check, status: 'confirmed', detail }
}

export function mismatch(check, detail) {
  return { check, status: 'mismatch', detail }
}

/** Parse JSON a tool printed; `{ ok: false, error }` instead of throwing. */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `not JSON (${error.message}): ${String(text).slice(0, 200)}` }
  }
}

/** Flatten `forge test --json` into one row per test. */
export function flattenTestResults(report) {
  const rows = []
  for (const [suite, result] of Object.entries(report ?? {})) {
    const contract = suite.split(':').pop()
    for (const [test, outcome] of Object.entries(result?.test_results ?? {})) {
      const kindKey = Object.keys(outcome?.kind ?? {})[0]
      // forge 1.8.5: an invariant failure leaves `reason` and `counterexample` null and puts
      // both in `invariant_failures[]`, keyed by the invariant's name without parentheses.
      const invariant = (outcome?.invariant_failures ?? []).find(
        (failure) => failure?.name === test.replace(/\(.*\)$/, '')
      )
      rows.push({
        id: `${contract}.${test}`,
        contract,
        test,
        status: outcome?.status,
        reason: outcome?.reason ?? invariant?.reason ?? '',
        kind: KINDS[kindKey] ?? `unknown(${kindKey})`,
        counterexample: outcome?.counterexample ?? invariant?.counterexample ?? null,
      })
    }
  }
  return rows
}

/** The n-th 32-byte ABI word of calldata after the selector, as a BigInt. */
export function calldataWord(calldata, index) {
  const hex = String(calldata ?? '').replace(/^0x/, '')
  const word = hex.slice(8 + 64 * index, 8 + 64 * (index + 1))
  if (word.length !== 64) return null
  return BigInt(`0x${word}`)
}

function sequenceSignatures(counterexample) {
  let calls = counterexample?.Sequence
  // forge 1.8.5 serialises a sequence as [originalLength, [calls…]].
  if (Array.isArray(calls) && calls.length === 2 && Array.isArray(calls[1])) calls = calls[1]
  if (!Array.isArray(calls)) return null
  return calls.map((call) => call?.signature ?? call?.func_name ?? '')
}

function containsInOrder(haystack, needles) {
  let at = 0
  for (const item of haystack) if (item === needles[at]) at += 1
  return at === needles.length
}

function checkFailure(expected, row) {
  const name = `test ${expected.contract}.${expected.test}`
  if (!row) return mismatch(name, 'not in forge output')
  if (row.status !== 'Failure') return mismatch(name, `status ${row.status}, expected Failure`)
  if (row.kind !== expected.kind)
    return mismatch(name, `kind ${row.kind}, expected ${expected.kind}`)
  if (!row.reason.includes(expected.reasonContains)) {
    return mismatch(name, `reason "${row.reason}" lacks "${expected.reasonContains}"`)
  }
  if (expected.counterexample) {
    const { arg, gte, lte } = expected.counterexample
    const value = calldataWord(row.counterexample?.Single?.calldata, arg)
    if (value === null) return mismatch(name, `no decodable counterexample argument ${arg}`)
    if (gte !== undefined && value < BigInt(gte)) return mismatch(name, `arg ${value} < ${gte}`)
    if (lte !== undefined && value > BigInt(lte)) return mismatch(name, `arg ${value} > ${lte}`)
  }
  if (expected.sequence) {
    const calls = sequenceSignatures(row.counterexample)
    if (!calls) return mismatch(name, 'no call sequence in the counterexample')
    if (!containsInOrder(calls, expected.sequence.containsInOrder)) {
      return mismatch(
        name,
        `sequence [${calls.join(', ')}] lacks ${expected.sequence.containsInOrder}`
      )
    }
  }
  return confirmed(name, row.reason)
}

/** Compare a finished `forge test --json` run with the fixture's `expect.test`. */
export function compareTests(expect, run) {
  if (expect.outcome === 'error') {
    const parsed = parseJson(run.stdout)
    const passed = parsed.ok
      ? flattenTestResults(parsed.value).filter((r) => r.status === 'Success')
      : []
    if (run.exitCode === 0) return [mismatch('test run', 'forge test exited 0 on a broken build')]
    if (passed.length) return [mismatch('test run', `reported passing: ${passed.map((r) => r.id)}`)]
    return [confirmed('test run', `forge test exited ${run.exitCode}, no test reported`)]
  }

  const parsed = parseJson(run.stdout)
  if (!parsed.ok) return [mismatch('test run', parsed.error)]
  const rows = flattenTestResults(parsed.value)
  if (rows.length === 0) return [mismatch('test run', 'forge reported no tests')]
  const byId = new Map(rows.map((row) => [row.id, row]))
  const results = []

  const expectedIds = new Set([
    ...expect.passing,
    ...expect.failing.map((f) => `${f.contract}.${f.test}`),
  ])
  const unexpected = rows.filter((row) => !expectedIds.has(row.id)).map((row) => row.id)
  if (unexpected.length) results.push(mismatch('test inventory', `unexpected: ${unexpected}`))

  for (const id of expect.passing) {
    const row = byId.get(id)
    results.push(
      row?.status === 'Success'
        ? confirmed(`test ${id}`, 'passes')
        : mismatch(
            `test ${id}`,
            row ? `status ${row.status}: ${row.reason}` : 'not in forge output'
          )
    )
  }
  for (const expected of expect.failing) {
    results.push(checkFailure(expected, byId.get(`${expected.contract}.${expected.test}`)))
  }

  const shouldFail = expect.failing.length > 0
  if (shouldFail !== (run.exitCode !== 0)) {
    results.push(mismatch('exit code', `forge test exited ${run.exitCode}`))
  }
  return results
}

/** `file:line` locations that solc reported as errors, from `forge build --json` or plain text. */
export function buildErrors(run) {
  const parsed = parseJson(run.stdout)
  const entries = parsed.ok && Array.isArray(parsed.value?.errors) ? parsed.value.errors : null
  const texts = entries
    ? entries
        .filter((e) => e.severity === 'error')
        .map((e) => `${e.type ?? ''}: ${e.formattedMessage ?? e.message ?? ''}`)
    : [`${run.stdout}\n${run.stderr}`]
  const located = []
  for (const text of texts) {
    for (const match of text.matchAll(/-->\s*([^\s:]+\.sol):(\d+):\d+/g)) {
      located.push({ file: match[1], line: Number(match[2]), text })
    }
  }
  return { located, structured: Boolean(entries) }
}

/** Compare `forge build` with the fixture's `expect.build`. */
export function compareBuild(expect, run) {
  if (expect.outcome === 'success') {
    return [
      run.exitCode === 0
        ? confirmed('build', 'forge build exited 0')
        : mismatch('build', `forge build exited ${run.exitCode}: ${run.stderr.slice(0, 300)}`),
    ]
  }
  if (run.exitCode === 0) return [mismatch('build', 'forge build exited 0 on a broken project')]
  const { located } = buildErrors(run)
  return expect.errors.map((want) => {
    const name = `build error ${want.file}:${want.line}`
    const hit = located.find(
      (loc) =>
        loc.file.endsWith(want.file) &&
        loc.line === want.line &&
        loc.text.includes(want.messageContains ?? '')
    )
    return hit
      ? confirmed(name, hit.text.split('\n')[0])
      : mismatch(name, `reported: ${JSON.stringify(located)}`)
  })
}

/**
 * Compare `forge inspect <contract> storageLayout --json` runs ({ exitCode, stdout, stderr }
 * per contract) with `expect.storageLayout`. A failed inspect is a mismatch even if it printed.
 */
export function compareStorageLayout(expected, runsByContract) {
  return Object.entries(expected)
    .filter(([key]) => !['label', 'note'].includes(key))
    .map(([contract, slots]) => {
      const run = runsByContract[contract]
      if (!run) return mismatch(`storage ${contract}`, 'forge inspect was not run')
      if (run.exitCode !== 0) {
        return mismatch(
          `storage ${contract}`,
          `forge inspect exited ${run.exitCode}: ${run.stderr}`
        )
      }
      const parsed = parseJson(run.stdout)
      if (!parsed.ok) return mismatch(`storage ${contract}`, parsed.error)
      const actual = (parsed.value?.storage ?? []).map((s) => [s.label, Number(s.slot)])
      return JSON.stringify(actual) === JSON.stringify(slots)
        ? confirmed(`storage ${contract}`, JSON.stringify(actual))
        : mismatch(`storage ${contract}`, `got ${JSON.stringify(actual)}`)
    })
}

/** Files the tests must not have created, e.g. an FFI marker while FFI is off (NFR-11). */
export function compareCreatedFiles(expect, projectDir) {
  return (expect.mustNotCreate ?? []).map((file) =>
    fs.existsSync(path.join(projectDir, file))
      ? mismatch(`not created: ${file}`, 'the file exists after the test run')
      : confirmed(`not created: ${file}`, 'absent after the test run')
  )
}

/** True when `forge --version` names exactly `wanted` (not 1.8.50, not 1.8.5-nightly). */
export function forgeVersionMatches(versionOutput, wanted) {
  const found = String(versionOutput).match(/^forge Version:\s*v?(\S+)/m)?.[1]
  if (!found) return false
  // Release builds print the bare version; `-stable` is the only suffix accepted. Nightlies and
  // release candidates of the same number are different binaries.
  return found === wanted || found === `${wanted}-stable`
}
