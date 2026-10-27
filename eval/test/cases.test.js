import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { listCandidates } from '../lib/candidates.js'
import {
  evaluateCase,
  fillPlaceholders,
  markerPaths,
  plantMarkers,
  readCaseFile,
  readCases,
  resolveEnv,
} from '../lib/cases.js'
import { EVAL_ROOT, FIXTURES_DIR, readJson } from '../lib/fixtures.js'

const run = promisify(execFile)
const STUB = path.join(import.meta.dirname, 'support', 'stub-server.mjs')
const text = (t, isError = false) => ({ isError, content: [{ type: 'text', text: t }] })

describe('lint cases file', () => {
  const cases = readCases('lint')

  it('exists for every stage a candidate is pinned for that has cases, with unique ids', () => {
    assert.ok(cases.length > 0)
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length)
    assert.ok(listCandidates().some((c) => c.stage === 'lint'))
  })

  it('points only at fixtures that exist, and gives every case a reason', () => {
    for (const c of cases) {
      assert.ok(fs.existsSync(path.join(FIXTURES_DIR, c.fixture)), c.fixture)
      assert.ok(c.why?.length > 10, `${c.id} needs a why`)
      assert.ok(Object.keys(c.expect).length > 0, `${c.id} has no expectation`)
    }
  })

  it('covers F10, the C4 fixtures with and without FORCE_COLOR, and code loading', () => {
    const ids = cases.map((c) => c.id)
    for (const fx of ['F10', 'F14', 'F15', 'F16'])
      assert.ok(
        ids.some((id) => id.startsWith(fx)),
        fx
      )
    assert.ok(cases.some((c) => c.env?.FORCE_COLOR === '1'))
    assert.ok(cases.filter((c) => c.expect.markerAbsent).length >= 6)
  })

  it('expects F14/F15 to name exactly what their ground truth says did not run', () => {
    for (const fx of ['F14-missing-plugin', 'F15-unknown-rule']) {
      const { messageContains } = readJson(path.join(FIXTURES_DIR, fx, 'GROUND_TRUTH.json')).expect
        .lint
      for (const c of cases.filter((x) => x.fixture === fx)) {
        assert.equal(
          c.expect.includes,
          undefined,
          `${c.id}: a bare mention can be met by the config echo`
        )
        assert.ok(
          c.expect.matches.every((m) => m.replaceAll('\\', '').includes(messageContains)),
          `${c.id} must look for ${messageContains}`
        )
      }
    }
  })
})

describe('build-test cases file', () => {
  const file = readCaseFile('build-test')
  const cases = file.cases
  const truthOf = (fixture) =>
    readJson(path.join(FIXTURES_DIR, fixture, 'GROUND_TRUTH.json')).expect.test

  it('has unique ids, existing fixtures, a reason and run-health checks on every case', () => {
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length)
    assert.ok(listCandidates().some((c) => c.stage === 'build-test'))
    for (const c of cases) {
      assert.ok(fs.existsSync(path.join(FIXTURES_DIR, c.fixture)), c.fixture)
      assert.ok(c.why?.length > 10, `${c.id} needs a why`)
      assert.equal(c.expect.stdoutClean, true, `${c.id}: stdoutClean`)
      assert.equal(c.expect.noOrphans, true, `${c.id}: noOrphans`)
    }
  })

  it('checks ground truth only where the fixture lists passing and failing tests', () => {
    const checked = cases.filter((c) => c.expect.groundTruth)
    assert.ok(checked.length >= 8)
    for (const c of checked) {
      const truth = truthOf(c.fixture)
      assert.ok(Array.isArray(truth.failing) && Array.isArray(truth.passing), c.id)
      assert.match(truth.label, /^confirmed-by:forge@/, `${c.id}: ground truth not confirmed`)
    }
  })

  it('requires an error with a code wherever forge cannot produce a report (C4)', () => {
    for (const fx of ['F04-compile-error', 'F08-hardhat-only']) {
      const outcome = truthOf(fx).outcome
      assert.notEqual(outcome, 'pass')
      for (const c of cases.filter((x) => x.fixture === fx && x.tool === 'run_tests')) {
        assert.equal(c.expect.isError, true, c.id)
        assert.ok(
          c.expect.includes?.some((s) => /^[A-Z_]+$/.test(s)),
          `${c.id}: no error code`
        )
      }
    }
    for (const id of ['F05-no-match', 'F05-forge-missing'])
      assert.equal(cases.find((c) => c.id === id).expect.isError, true)
  })

  it('plants ffi = true for every FFI case and requires the marker never to appear', () => {
    const ffi = cases.filter((c) => c.id.startsWith('F12-ffi-on'))
    assert.ok(ffi.length >= 3)
    const { mustNotCreate } = truthOf('F12-ffi-disabled')
    for (const c of ffi) {
      assert.match(c.files['foundry.toml'], /^ffi = true$/m, c.id)
      assert.deepEqual(c.expect.filesAbsent, mustNotCreate, c.id)
    }
  })

  it('holds F13 to a byte budget and exact counts', () => {
    const f13 = cases.filter((c) => c.fixture === 'F13-many-failures')
    assert.ok(f13.length >= 2)
    for (const c of f13) {
      assert.ok(c.expect.maxTextBytes <= (c.args.max_bytes ?? 8192), c.id)
      assert.equal(c.expect.groundTruth.failures, 'none', c.id)
    }
  })

  it('takes the solc path from the harness environment, never a fixed path', () => {
    assert.deepEqual(file.env, { FOUNDRY_SOLC: '$ENV:SAK_SOLC' })
  })
})

describe('case environment', () => {
  it('merges shared and own env and resolves $ENV: references', () => {
    assert.deepEqual(
      resolveEnv({ A: '$ENV:X', B: 'b' }, { B: 'own', C: '$ENV:Y' }, { X: '/x', Y: 'y' }),
      { A: '/x', B: 'own', C: 'y' }
    )
  })

  it('refuses a reference the harness environment does not provide', () => {
    assert.throws(() => resolveEnv({ A: '$ENV:MISSING' }, {}, {}), /A needs MISSING/)
    assert.throws(() => resolveEnv({ A: '$ENV:EMPTY' }, {}, { EMPTY: '' }), /A needs EMPTY/)
  })
})

describe('ground-truth evaluation', () => {
  const truth = {
    passing: ['MathTest.test_squareOfThree()'],
    failing: [
      {
        contract: 'MathTest',
        test: 'testFuzz_squareIsMonotonic(uint256)',
        kind: 'fuzz',
        reasonContains: '0x11',
        counterexample: { arg: 0, gte: '340282366920938463463374607431768211456' },
      },
    ],
  }
  const failure = (over = {}) => ({
    test: 'MathTest.testFuzz_squareIsMonotonic(uint256)',
    kind: 'fuzz',
    reason: 'panic: arithmetic underflow or overflow (0x11)',
    counterexample: { args: '340282366920938463463374607431768211456 [3.402e38]' },
    ...over,
  })
  const result = (failures, summary = { passed: 1, failed: 1 }) =>
    text(JSON.stringify({ status: 'failed', summary, failures }))
  const judge = (call, t = truth, failures = 'all') =>
    evaluateCase({ groundTruth: { failures } }, call, { groundTruth: t })

  it('passes a result that matches counts, name, reason, kind and the counterexample bound', () => {
    assert.equal(judge(result([failure()])).passed, true)
  })

  it('fails a wrong reason, a wrong kind, wrong counts or a counterexample below the bound', () => {
    assert.equal(judge(result([failure({ reason: 'something else' })])).passed, false)
    assert.equal(judge(result([failure({ kind: 'unit' })])).passed, false)
    assert.equal(judge(result([failure()], { passed: 2, failed: 0 })).passed, false)
    const below = failure({ counterexample: { args: '340282366920938463463374607431768211455' } })
    assert.equal(judge(result([below])).passed, false)
  })

  it('fails when a passing test is reported as failing', () => {
    const extra = failure({ test: 'MathTest.test_squareOfThree()', reason: 'x' })
    assert.equal(judge(result([failure(), extra])).passed, false)
  })

  it('catches a passing test listed as failing under another spelling, by name boundary', () => {
    for (const test of ['MathTest::test_squareOfThree()', 'MathTest.test_squareOfThree']) {
      const extra = failure({ test, reason: 'x' })
      assert.equal(judge(result([failure(), extra])).passed, false, test)
    }
    // A longer name that starts with the passing one is a different test.
    const longer = {
      passing: ['V.test_a()'],
      failing: [{ contract: 'V', test: 'test_ab()', kind: 'unit', reasonContains: 'r' }],
    }
    const call = result([{ test: 'V.test_ab()', kind: 'unit', reason: 'r' }])
    assert.equal(judge(call, longer).passed, true)
    // And the failing test itself must be named on a boundary too.
    const wrong = result([{ test: 'V.test_abc()', kind: 'unit', reason: 'r' }])
    assert.equal(judge(wrong, longer).passed, false)
  })

  it('takes the counterexample from the result, not from trace lines', () => {
    const trace = [
      '[1] MathTest::testFuzz_squareIsMonotonic(340282366920938463463374607431768211456)',
    ]
    assert.equal(judge(result([failure({ counterexample: { args: '5' }, trace })])).passed, false)
    const none = failure({ trace })
    delete none.counterexample
    assert.equal(judge(result([none])).passed, false)
  })

  it('requires the kind to be the only kind the failure states', () => {
    assert.equal(judge(result([failure({ kind: 'unit', note: 'fuzz' })])).passed, false)
  })

  it('checks a call sequence in order', () => {
    const seq = {
      passing: [],
      failing: [
        {
          contract: 'S',
          test: 'invariant_x()',
          kind: 'invariant',
          reasonContains: 'mismatch',
          sequence: { containsInOrder: ['mint(uint256)', 'burnFrom(uint256)'] },
        },
      ],
    }
    const calls = (a, b) =>
      result(
        [
          {
            test: 'S.invariant_x()',
            kind: 'invariant',
            reason: 'mismatch',
            sequence: { calls: [{ call: `H.${a}` }, { call: `H.${b}` }] },
          },
        ],
        { passed: 0, failed: 1 }
      )
    assert.equal(judge(calls('mint(uint256)', 'burnFrom(uint256)'), seq).passed, true)
    assert.equal(judge(calls('burnFrom(uint256)', 'mint(uint256)'), seq).passed, false)
  })

  it('with failures "none" checks only the counts', () => {
    assert.equal(judge(result([]), truth, 'none').passed, true)
    assert.equal(judge(result([], { passed: 1, failed: 0 }), truth, 'none').passed, false)
  })

  it('never passes text that is not JSON, or a fixture without test lists', () => {
    assert.equal(judge(text('1 passed, 1 failed')).passed, false)
    assert.equal(judge(result([failure()]), { outcome: 'error' }).passed, false)
  })
})

describe('byte, file and process checks', () => {
  it('fails maxTextBytes over the limit, counting bytes not characters', () => {
    assert.equal(evaluateCase({ maxTextBytes: 4 }, text('abcd')).passed, true)
    assert.equal(evaluateCase({ maxTextBytes: 4 }, text('abcé')).passed, false)
  })

  it('fails filesAbsent when the file exists, and noOrphans when a process outlived', () => {
    const files = { filesAbsent: ['ffi-marker.txt'] }
    assert.equal(evaluateCase(files, text('x'), { presentFiles: [] }).passed, true)
    assert.equal(evaluateCase(files, text('x'), { presentFiles: ['ffi-marker.txt'] }).passed, false)
    assert.equal(evaluateCase({ noOrphans: true }, text('x'), { orphans: true }).passed, false)
    assert.equal(evaluateCase({ noOrphans: true }, text('x'), { orphans: false }).passed, true)
  })
})

describe('case evaluation', () => {
  it('passes only when every expectation holds', () => {
    const expect = { isError: false, includes: ['sak-missing'], excludes: ['✅'] }
    assert.equal(evaluateCase(expect, text('⚠️ degraded: sak-missing did not load')).passed, true)
    assert.equal(evaluateCase(expect, text('No violations ✅')).passed, false)
    assert.equal(evaluateCase(expect, text('sak-missing', true)).passed, false)
  })

  it('does not let the get_config echo of the project config satisfy a C4 case', () => {
    const lintCases = readCases('lint')
    for (const [fx, config] of [
      ['F14-missing-plugin', { extends: 'solhint:recommended', plugins: ['sak-missing'] }],
      [
        'F15-unknown-rule',
        { extends: 'solhint:recommended', rules: { 'sak-no-such-rule': 'error' } },
      ],
    ]) {
      // What a server that reports nothing still prints: the config, verbatim.
      const echo = text(
        `**Found:** \`.solhint.json\`\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``
      )
      for (const c of lintCases.filter((x) => x.fixture === fx)) {
        assert.equal(evaluateCase(c.expect, echo).passed, false, `${c.id} passed on the bare echo`)
      }
    }
  })

  it('accepts the diagnostics a reporting server gives (Solhint wording and a paraphrase)', () => {
    const [f14] = readCases('lint').filter((x) => x.id === 'F14-lint_project')
    const [f15] = readCases('lint').filter((x) => x.id === 'F15-lint_project')
    const solhint14 =
      "[solhint] Warning: Could not load solhint-plugin-sak-missing, make sure it's installed"
    assert.equal(evaluateCase(f14.expect, text(solhint14)).passed, true)
    assert.equal(evaluateCase(f14.expect, text('plugin sak-missing was not loaded')).passed, true)
    assert.equal(
      evaluateCase(f15.expect, text("[solhint] Warning: Rule 'sak-no-such-rule' doesn't exist"))
        .passed,
      true
    )
    assert.equal(evaluateCase(f15.expect, text('Unknown rule: sak-no-such-rule')).passed, true)
  })

  it('fails excludes when the forbidden text is present', () => {
    const expect = { excludes: ['✅'] }
    assert.equal(evaluateCase(expect, text('config looks sound')).passed, true)
    assert.equal(
      evaluateCase(expect, text('✅ Effective config already enables the recommended checks'))
        .passed,
      false
    )
  })

  it('fails stdoutClean when stray bytes reached stdout', () => {
    const expect = { stdoutClean: true }
    assert.equal(evaluateCase(expect, text('ok')).passed, true)
    assert.equal(evaluateCase(expect, text('ok'), { pollutionBytes: 31 }).passed, false)
  })

  it('never passes a call that failed (timeout, crash)', () => {
    const verdict = evaluateCase({ isError: true }, { error: 'timeout: no answer' })
    assert.equal(verdict.passed, false)
    assert.match(verdict.checks[0].detail, /timeout/)
  })

  it('fails when the marker was written, even if the tool reported an error', () => {
    const expect = { isError: true, markerAbsent: true }
    assert.equal(evaluateCase(expect, text('Error: rejected', true)).passed, true)
    assert.equal(
      evaluateCase(expect, text('Error: rejected', true), { markerFired: true }).passed,
      false
    )
  })

  it('plants marker modules that fire when loaded, and fills placeholders', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-markers-'))
    const project = path.join(work, 'project')
    fs.mkdirSync(project)
    const markers = markerPaths(work, 'c1')
    plantMarkers(markers)
    const args = fillPlaceholders(
      { config: { extends: ['$MARKER_JS', '$MARKER_REL'], pluginPaths: ['$MARKER_DIR'] } },
      markers,
      project
    )
    assert.deepEqual(args.config.extends, [markers.js, '../markers/c1.js'])
    assert.deepEqual(args.config.pluginPaths, [markers.dir])
    assert.equal(fs.existsSync(markers.fired), false)
    // Loading the marker as CommonJS (what Solhint's require() would do) writes the file.
    return run(process.execPath, ['-e', `require(${JSON.stringify(markers.js)})`]).then(() => {
      assert.equal(fs.existsSync(markers.fired), true)
    })
  })
})

describe('run-cases.mjs end to end', () => {
  it('exits 2 without a report when a required binary does not run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-runcases-bin-'))
    const candidateFile = path.join(dir, 'candidate.json')
    fs.writeFileSync(
      candidateFile,
      JSON.stringify({
        id: 'stub-mcp',
        manifestId: null,
        stage: 'build-test',
        install: {
          type: 'npm',
          package: 'stub-mcp',
          version: '1.0.0',
          integrity: 'sha512-AA==',
          bin: 'x',
        },
        transport: 'stdio',
        args: [],
        network: 'none',
        requiresBinaries: ['sak-no-such-binary'],
        deniedTools: [],
      })
    )
    const casesFile = path.join(dir, 'cases.json')
    fs.writeFileSync(
      casesFile,
      JSON.stringify({
        cases: [
          { id: 'x', fixture: 'F01-erc20-clean', tool: 't', args: {}, expect: { isError: true } },
        ],
      })
    )
    const out = path.join(dir, 'report.json')
    const script = path.join(EVAL_ROOT, 'scripts', 'run-cases.mjs')
    const args = [script, 'stub-mcp', dir, '--candidate-file', candidateFile, '--cases', casesFile]
    await assert.rejects(run(process.execPath, [...args, '--out', out]), (error) => {
      assert.equal(error.code, 2)
      assert.match(error.stderr, /required binary sak-no-such-binary does not run/)
      return true
    })
    assert.equal(fs.existsSync(out), false)
  })

  it('runs each case in its own server and records pass and fail', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-runcases-'))
    const pkgDir = path.join(dir, 'node_modules', 'stub-mcp')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'stub-mcp', version: '1.0.0', bin: { 'stub-mcp': 'bin.mjs' } })
    )
    fs.writeFileSync(path.join(pkgDir, 'bin.mjs'), `await import(${JSON.stringify(STUB)})\n`)
    const candidateFile = path.join(dir, 'candidate.json')
    fs.writeFileSync(
      candidateFile,
      JSON.stringify({
        id: 'stub-mcp',
        manifestId: null,
        stage: 'lint',
        install: {
          type: 'npm',
          package: 'stub-mcp',
          version: '1.0.0',
          integrity: 'sha512-AA==',
          bin: 'stub-mcp',
        },
        transport: 'stdio',
        args: [],
        network: 'none',
        requiresBinaries: [],
        deniedTools: [],
      })
    )
    const casesFile = path.join(dir, 'cases.json')
    fs.writeFileSync(
      casesFile,
      JSON.stringify({
        cases: [
          {
            id: 'ok',
            fixture: 'F01-erc20-clean',
            tool: 'lint',
            args: {},
            why: 'stub answers ok',
            expect: { isError: false, includes: ['ok'] },
          },
          {
            id: 'wants-error',
            fixture: 'F01-erc20-clean',
            tool: 'lint',
            args: {},
            why: 'stub never errors',
            expect: { isError: true },
          },
        ],
      })
    )
    const out = path.join(dir, 'report.json')
    await run(process.execPath, [
      path.join(EVAL_ROOT, 'scripts', 'run-cases.mjs'),
      'stub-mcp',
      dir,
      '--candidate-file',
      candidateFile,
      '--cases',
      casesFile,
      '--out',
      out,
      '--timeout-ms',
      '5000',
    ])
    const report = readJson(out)
    assert.equal(report.passed, 1)
    assert.equal(report.failed, 1)
    assert.deepEqual(
      report.results.map((r) => [r.id, r.passed, r.orphans]),
      [
        ['ok', true, false],
        ['wants-error', false, false],
      ]
    )
  })
})
