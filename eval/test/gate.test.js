import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { EVAL_ROOT, forgeStdProblems, readDeps, treeDigest } from '../lib/fixtures.js'

const run = promisify(execFile)
const GATE = path.join(EVAL_ROOT, 'scripts', 'gate-cases.mjs')

function setup(results, expectedFailures = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-gate-'))
  const report = path.join(dir, 'cases.json')
  const passed = results.filter((r) => r.passed).length
  fs.writeFileSync(
    report,
    JSON.stringify({
      id: 'stub',
      version: '1.0.0',
      passed,
      failed: results.length - passed,
      results,
    })
  )
  const candidate = path.join(dir, 'candidate.json')
  fs.writeFileSync(candidate, JSON.stringify({ id: 'stub', expectedFailures }))
  return [report, '--candidate-file', candidate]
}

async function gate(args) {
  try {
    const { stderr } = await run(process.execPath, [GATE, ...args])
    return { code: 0, stderr }
  } catch (error) {
    return { code: error.code, stderr: error.stderr }
  }
}

describe('gate-cases.mjs', () => {
  const ok = { id: 'a', passed: true }
  const bad = { id: 'b', passed: false }

  it('passes when every case passed and none was expected to fail', async () => {
    assert.equal((await gate(setup([ok]))).code, 0)
  })

  it('fails the job on one failing case', async () => {
    const { code, stderr } = await gate(setup([ok, bad]))
    assert.equal(code, 1)
    assert.match(stderr, /b failed/)
  })

  it('accepts a failure only when the candidate declares it, with a reason', async () => {
    const declared = [{ case: 'b', why: 'known upstream issue, tracked' }]
    assert.equal((await gate(setup([ok, bad], declared))).code, 0)
  })

  it('fails when a declared failure now passes, so the list cannot go stale', async () => {
    const declared = [{ case: 'a', why: 'was failing before the fix' }]
    const { code, stderr } = await gate(setup([ok], declared))
    assert.equal(code, 1)
    assert.match(stderr, /a is listed in expectedFailures but did not fail/)
  })

  it('fails when no case ran', async () => {
    assert.equal((await gate(setup([]))).code, 1)
  })

  it('is a usage error without a readable report', async () => {
    assert.equal((await gate(['/nonexistent/cases.json'])).code, 2)
  })
})

describe('forge-std dependency check', () => {
  const { commit } = readDeps().forgeStd
  function fixture({ pin = commit, record = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-dep-'))
    const lib = path.join(dir, 'lib', 'forge-std')
    fs.mkdirSync(path.join(lib, 'src'), { recursive: true })
    fs.writeFileSync(path.join(lib, 'src', 'Test.sol'), '// test\n')
    if (pin) fs.writeFileSync(path.join(lib, '.pinned-commit'), `${pin}\n`)
    if (record) fs.writeFileSync(path.join(lib, '.tree-sha256'), `${treeDigest(lib)}\n`)
    return { dir, lib }
  }

  it('accepts forge-std at the pinned commit with unchanged files', () => {
    assert.deepEqual(forgeStdProblems([fixture().dir], commit), [])
  })

  it('reports forge-std missing, at another commit, or changed after install', () => {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-dep-'))
    assert.match(forgeStdProblems([missing], commit)[0], /forge-std missing/)
    assert.match(forgeStdProblems([fixture({ pin: 'f00' }).dir], commit)[0], /forge-std f00/)
    assert.match(forgeStdProblems([fixture({ record: false }).dir], commit)[0], /differ/)
    const changed = fixture()
    fs.writeFileSync(path.join(changed.lib, 'src', 'Test.sol'), '// edited\n')
    assert.match(forgeStdProblems([changed.dir], commit)[0], /differ/)
    fs.rmSync(path.join(changed.lib, 'src', 'Test.sol'))
    assert.match(forgeStdProblems([changed.dir], commit)[0], /differ/)
  })

  it('makes run-cases exit 2 before any case for a dependency it does not know', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-dep-run-'))
    const candidate = path.join(dir, 'candidate.json')
    fs.writeFileSync(
      candidate,
      JSON.stringify({
        id: 'stub',
        stage: 'build-test',
        install: {
          type: 'npm',
          package: 'stub',
          version: '1.0.0',
          integrity: 'sha512-AA==',
          bin: 'x',
        },
        args: [],
        requiresBinaries: [],
      })
    )
    const cases = path.join(dir, 'cases.json')
    fs.writeFileSync(
      cases,
      JSON.stringify({
        fixtureDeps: ['no-such-dep'],
        cases: [{ id: 'x', fixture: 'F01-erc20-clean', tool: 't', args: {}, expect: {} }],
      })
    )
    const script = path.join(EVAL_ROOT, 'scripts', 'run-cases.mjs')
    const args = [script, 'stub', dir, '--candidate-file', candidate, '--cases', cases]
    await assert.rejects(run(process.execPath, args), (error) => {
      assert.equal(error.code, 2)
      assert.match(error.stderr, /unknown fixture dependency no-such-dep/)
      return true
    })
  })
})
