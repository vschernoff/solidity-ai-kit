import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { FIXTURES_DIR, readJson } from '../lib/fixtures.js'
import {
  calldataWord,
  compareBuild,
  compareCreatedFiles,
  compareStorageLayout,
  compareTests,
  flattenTestResults,
} from '../lib/forge-results.js'

// The samples below follow the shape of `forge test --json` as this harness expects it.
// They are written by hand; the CI job (EVAL.yml) is where the real shape is confirmed.
const gt = (name) => readJson(path.join(FIXTURES_DIR, name, 'GROUND_TRUTH.json')).expect

const word = (value) => BigInt(value).toString(16).padStart(64, '0')
const unit = (status, reason = null) => ({ status, reason, kind: { Unit: { gas: 1 } } })

function bankReport({ transferReason = 'balance mismatch: 99 != 100' } = {}) {
  return {
    'test/Bank.t.sol:BankTest': {
      test_results: {
        'test_credit()': unit('Success'),
        'test_transfer()': unit('Failure', transferReason),
      },
    },
  }
}

const statuses = (results) => results.map((r) => r.status)

describe('forge result comparison', () => {
  it('flattens suites into contract-qualified test ids', () => {
    const rows = flattenTestResults(bankReport())
    assert.deepEqual(
      rows.map((r) => [r.id, r.status, r.kind]),
      [
        ['BankTest.test_credit()', 'Success', 'unit'],
        ['BankTest.test_transfer()', 'Failure', 'unit'],
      ]
    )
  })

  it('confirms F05 when forge reports the planted failure', () => {
    const results = compareTests(gt('F05-failing-assertion').test, {
      exitCode: 1,
      stdout: JSON.stringify(bankReport()),
    })
    assert.deepEqual(statuses(results), ['confirmed', 'confirmed'])
  })

  it('flags a wrong failure reason', () => {
    const results = compareTests(gt('F05-failing-assertion').test, {
      exitCode: 1,
      stdout: JSON.stringify(bankReport({ transferReason: 'revert: insufficient' })),
    })
    assert.ok(
      results.some((r) => r.status === 'mismatch' && /lacks "balance mismatch"/.test(r.detail))
    )
  })

  it('never confirms output it cannot parse (C4)', () => {
    const results = compareTests(gt('F05-failing-assertion').test, {
      exitCode: 1,
      stdout: 'Compiler run failed',
    })
    assert.deepEqual(statuses(results), ['mismatch'])
  })

  it('never confirms an empty test report (C4)', () => {
    const results = compareTests(gt('F01-erc20-clean').test, { exitCode: 0, stdout: '{}' })
    assert.deepEqual(statuses(results), ['mismatch'])
  })

  it('flags tests that are not in the ground truth', () => {
    const report = bankReport()
    report['test/Bank.t.sol:BankTest'].test_results['test_extra()'] = unit('Success')
    const results = compareTests(gt('F05-failing-assertion').test, {
      exitCode: 1,
      stdout: JSON.stringify(report),
    })
    assert.ok(results.some((r) => r.check === 'test inventory'))
  })

  it('checks a fuzz counterexample by predicate on its calldata', () => {
    const fuzzReport = (x) => ({
      'test/Math.t.sol:MathTest': {
        test_results: {
          'test_squareOfThree()': unit('Success'),
          'testFuzz_squareIsMonotonic(uint256)': {
            status: 'Failure',
            reason: 'panic: arithmetic underflow or overflow (0x11)',
            kind: { Fuzz: { runs: 1 } },
            counterexample: { Single: { calldata: `0x12345678${word(x)}` } },
          },
        },
      },
    })
    const expect = gt('F06-failing-fuzz').test
    const big = 2n ** 200n
    assert.deepEqual(
      statuses(compareTests(expect, { exitCode: 1, stdout: JSON.stringify(fuzzReport(big)) })),
      ['confirmed', 'confirmed']
    )
    const small = compareTests(expect, { exitCode: 1, stdout: JSON.stringify(fuzzReport(5n)) })
    assert.ok(
      small.some(
        (r) => r.status === 'mismatch' && /< 340282366920938463463374607431768211456/.test(r.detail)
      )
    )
  })

  it('checks an invariant call sequence in order', () => {
    const invariantReport = (calls) => ({
      'test/Supply.t.sol:SupplyInvariantTest': {
        test_results: {
          'test_mintUpdatesSupply()': unit('Success'),
          'invariant_supplyMatches()': {
            status: 'Failure',
            reason: 'supply mismatch: 10 != 7',
            kind: { Invariant: { runs: 1, calls: 2 } },
            counterexample: { Sequence: calls.map((signature) => ({ signature })) },
          },
        },
      },
    })
    const expect = gt('F07-failing-invariant').test
    const ok = compareTests(expect, {
      exitCode: 1,
      stdout: JSON.stringify(
        invariantReport(['mint(uint256)', 'mint(uint256)', 'burnFrom(uint256)'])
      ),
    })
    assert.deepEqual(statuses(ok), ['confirmed', 'confirmed'])
    const reversed = compareTests(expect, {
      exitCode: 1,
      stdout: JSON.stringify(invariantReport(['burnFrom(uint256)', 'mint(uint256)'])),
    })
    assert.ok(reversed.some((r) => r.status === 'mismatch'))
  })

  it('treats a test run on a broken build as confirmed only if nothing is reported as passed', () => {
    const expect = gt('F04-compile-error').test
    assert.deepEqual(statuses(compareTests(expect, { exitCode: 1, stdout: '' })), ['confirmed'])
    assert.deepEqual(statuses(compareTests(expect, { exitCode: 0, stdout: '{}' })), ['mismatch'])
  })

  it('locates the F04 compile error at file:line from forge build --json', () => {
    const stdout = JSON.stringify({
      errors: [
        {
          severity: 'error',
          type: 'TypeError',
          formattedMessage:
            'TypeError: Type literal_string "not a number" is not implicitly convertible to expected type uint256.\n  --> src/Broken.sol:13:9:\n',
        },
      ],
    })
    const expect = gt('F04-compile-error').build
    assert.deepEqual(statuses(compareBuild(expect, { exitCode: 1, stdout, stderr: '' })), [
      'confirmed',
    ])
    assert.deepEqual(statuses(compareBuild(expect, { exitCode: 0, stdout: '', stderr: '' })), [
      'mismatch',
    ])
    const wrongLine = stdout.replace('Broken.sol:13', 'Broken.sol:14')
    assert.deepEqual(
      statuses(compareBuild(expect, { exitCode: 1, stdout: wrongLine, stderr: '' })),
      ['mismatch']
    )
  })

  it('falls back to plain-text compiler output when build output is not JSON', () => {
    const stderr =
      'Error: Compiler run failed:\nError (7407): TypeError: ...\n  --> src/Broken.sol:13:9:'
    const expect = gt('F04-compile-error').build
    assert.deepEqual(statuses(compareBuild(expect, { exitCode: 1, stdout: '', stderr })), [
      'confirmed',
    ])
  })

  it('compares storage layouts slot by slot', () => {
    const expected = gt('F03-upgradeable-proxy').storageLayout
    const layout = (pairs) =>
      JSON.stringify({ storage: pairs.map(([label, slot]) => ({ label, slot: String(slot) })) })
    const good = { ImplV1: layout(expected.ImplV1), ImplV2: layout(expected.ImplV2) }
    assert.deepEqual(statuses(compareStorageLayout(expected, good)), ['confirmed', 'confirmed'])
    const bad = { ...good, ImplV2: layout(expected.ImplV1) }
    assert.deepEqual(statuses(compareStorageLayout(expected, bad)), ['confirmed', 'mismatch'])
  })

  it('decodes ABI words after the selector', () => {
    assert.equal(calldataWord(`0xdeadbeef${word(7)}${word(9)}`, 1), 9n)
    assert.equal(calldataWord('0xdeadbeef', 0), null)
  })

  it('fails F12 when the FFI marker exists after the run (NFR-11)', () => {
    const expect = gt('F12-ffi-disabled').test
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-f12-'))
    assert.deepEqual(statuses(compareCreatedFiles(expect, dir)), ['confirmed'])
    fs.writeFileSync(path.join(dir, 'ffi-marker.txt'), '')
    assert.deepEqual(statuses(compareCreatedFiles(expect, dir)), ['mismatch'])
  })
})
