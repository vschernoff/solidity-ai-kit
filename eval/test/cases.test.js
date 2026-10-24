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
  readCases,
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

describe('case evaluation', () => {
  it('passes only when every expectation holds', () => {
    const expect = { isError: false, includes: ['sak-missing'], excludes: ['✅'] }
    assert.equal(evaluateCase(expect, text('⚠️ degraded: sak-missing did not load')).passed, true)
    assert.equal(evaluateCase(expect, text('No violations ✅')).passed, false)
    assert.equal(evaluateCase(expect, text('sak-missing', true)).passed, false)
  })

  it('does not let the get_config echo of the project config satisfy a C4 case (review of #28)', () => {
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
