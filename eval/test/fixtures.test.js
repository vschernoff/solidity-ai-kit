import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  FIXTURES_DIR,
  SHARED_DIR,
  fixtureFiles,
  listFixtures,
  readDeps,
  readJson,
} from '../lib/fixtures.js'

const fixtures = listFixtures()
const deps = readDeps()
const schema = readJson(path.join(FIXTURES_DIR, 'ground-truth.schema.json'))
const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(
  schema
)

const MARKER = /@gt:([a-z0-9-]+)/g
const SOURCE_EXTENSIONS = new Set(['.sol', '.js'])

function sourceFiles(dir) {
  return fixtureFiles(dir).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
}

function markersIn(dir) {
  const found = []
  for (const file of sourceFiles(dir)) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')
    lines.forEach((text, index) => {
      for (const match of text.matchAll(MARKER)) {
        found.push({ id: match[1], file, line: index + 1 })
      }
    })
  }
  return found
}

function solidityFunctions(dir) {
  const names = new Set()
  for (const file of sourceFiles(dir).filter((f) => f.endsWith('.sol'))) {
    const text = fs
      .readFileSync(path.join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const match of text.matchAll(/contract\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
      for (const fn of match[2].matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) {
        const types = fn[2]
          .split(',')
          .map((param) => param.trim().split(/\s+/)[0])
          .filter(Boolean)
        names.add(`${match[1]}.${fn[1]}(${types.join(',')})`)
      }
    }
  }
  return names
}

describe('evaluation fixtures (SRS §8.3)', () => {
  it('has at least the ten fixtures the SRS asks for, numbered from F01 without gaps', () => {
    assert.ok(fixtures.length >= 10, `only ${fixtures.length} fixtures`)
    assert.deepEqual(
      fixtures.map(({ groundTruth }) => groundTruth.id),
      Array.from({ length: fixtures.length }, (_, i) => `F${String(i + 1).padStart(2, '0')}`)
    )
  })

  for (const { name, dir, groundTruth } of fixtures) {
    describe(name, () => {
      it('GROUND_TRUTH.json matches the schema', () => {
        assert.ok(validate(groundTruth), JSON.stringify(validate.errors, null, 2))
      })

      it('directory name matches id and name', () => {
        assert.equal(name, `${groundTruth.id}-${groundTruth.name}`)
      })

      it('pins the same solc as deps.json in every pragma', () => {
        assert.equal(groundTruth.solc, deps.solc)
        for (const file of sourceFiles(dir).filter((f) => f.endsWith('.sol'))) {
          const pragma = fs
            .readFileSync(path.join(dir, file), 'utf8')
            .match(/pragma solidity ([^;]+);/)
          assert.equal(pragma?.[1], deps.solc, file)
        }
      })

      it('starts every Solidity file with an MIT SPDX line', () => {
        for (const file of sourceFiles(dir).filter((f) => f.endsWith('.sol'))) {
          const first = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')[0]
          assert.equal(first, '// SPDX-License-Identifier: MIT', file)
        }
      })

      it('declares every planted defect, at the line its @gt marker is on, and nothing else', () => {
        const markers = markersIn(dir)
        const declared = groundTruth.planted.map(({ id, file, line }) => ({ id, file, line }))
        const key = ({ id, file, line }) => `${id}@${file}:${line}`
        assert.deepEqual(markers.map(key).sort(), declared.map(key).sort())
      })

      it('refers only to planted ids that exist', () => {
        const ids = new Set(groundTruth.planted.map(({ id }) => id))
        const refs = JSON.stringify(groundTruth.expect).matchAll(/"planted":"([a-z0-9-]+)"/g)
        for (const [, ref] of refs) assert.ok(ids.has(ref), `unknown planted id ${ref}`)
      })

      it('has project markers that match its layout (FR-1 cases)', () => {
        const files = fixtureFiles(dir)
        const hasFoundry = files.includes('foundry.toml')
        const hasHardhat = files.some((file) => /^hardhat\.config\.(js|cjs|mjs|ts)$/.test(file))
        const layout = { foundry: [true, false], hardhat: [false, true], both: [true, true] }
        assert.deepEqual([hasFoundry, hasHardhat], layout[groundTruth.layout])
      })

      if (groundTruth.layout !== 'hardhat') {
        it('uses the shared foundry.toml unchanged', () => {
          assert.equal(
            fs.readFileSync(path.join(dir, 'foundry.toml'), 'utf8'),
            fs.readFileSync(path.join(SHARED_DIR, 'foundry.toml'), 'utf8')
          )
        })
      }

      it('names only tests and properties that exist in its sources', () => {
        const functions = solidityFunctions(dir)
        const { test, fuzz } = groundTruth.expect
        for (const id of test.passing ?? []) assert.ok(functions.has(id), `missing ${id}`)
        for (const { contract, test: fn } of test.failing ?? []) {
          assert.ok(functions.has(`${contract}.${fn}`), `missing ${contract}.${fn}`)
        }
        if (fuzz.property) {
          assert.ok(functions.has(`${fuzz.contract}.${fuzz.property}()`), fuzz.property)
          assert.ok(fs.existsSync(path.join(dir, fuzz.harness)), fuzz.harness)
        }
      })

      it('lists every test function in its test files as passing or failing', () => {
        if (!['pass', 'fail'].includes(groundTruth.expect.test.outcome)) return
        const { passing, failing } = groundTruth.expect.test
        const expected = new Set([...passing, ...failing.map((f) => `${f.contract}.${f.test}`)])
        const testFunctions = [...solidityFunctions(path.join(dir))].filter((id) =>
          /\.(test|invariant)\w*\(/.test(id)
        )
        assert.deepEqual(testFunctions.sort(), [...expected].sort())
      })

      it('has a .solhint.json that is valid JSON, unless the fixture is about a broken one', () => {
        const text = fs.readFileSync(path.join(dir, '.solhint.json'), 'utf8')
        const brokenOnPurpose = groundTruth.expect.lint.outcome === 'error'
        assert.equal(
          brokenOnPurpose,
          (() => {
            try {
              JSON.parse(text)
              return false
            } catch {
              return true
            }
          })()
        )
      })

      if (groundTruth.expect.fuzz.harness) {
        it('uses the shared, FFI-free echidna.yaml', () => {
          assert.equal(
            fs.readFileSync(path.join(dir, 'echidna.yaml'), 'utf8'),
            fs.readFileSync(path.join(SHARED_DIR, 'echidna.yaml'), 'utf8')
          )
        })
      }
    })
  }

  it('keeps FFI off in the shared configs (NFR-11)', () => {
    assert.match(fs.readFileSync(path.join(SHARED_DIR, 'foundry.toml'), 'utf8'), /^ffi = false$/m)
    assert.match(
      fs.readFileSync(path.join(SHARED_DIR, 'echidna.yaml'), 'utf8'),
      /^allowFFI: false$/m
    )
  })

  it('never commits fetched dependencies', () => {
    for (const { dir } of fixtures) {
      assert.ok(!fixtureFiles(dir).some((file) => file.startsWith(path.join('lib', 'forge-std'))))
    }
  })

  it('backs every confirmed-by:forge label with a committed zero-mismatch report', () => {
    const resultsDir = path.join(FIXTURES_DIR, '..', 'results', 'ground-truth')
    const reports = fs.existsSync(resultsDir)
      ? fs.readdirSync(resultsDir).map((file) => readJson(path.join(resultsDir, file)))
      : []
    for (const { name, groundTruth } of fixtures) {
      const versions = new Set(
        [...JSON.stringify(groundTruth).matchAll(/confirmed-by:forge@([0-9.]+)/g)].map((m) => m[1])
      )
      for (const version of versions) {
        const backing = reports.find(
          (r) =>
            r.forge.includes(`Version: ${version}`) &&
            r.mismatches === 0 &&
            !r.drift &&
            r.fixtures[name]?.length > 0 &&
            r.fixtures[name].every((result) => result.status === 'confirmed')
        )
        assert.ok(backing, `${name}: no clean forge ${version} report in eval/results/ground-truth`)
      }
    }
  })
})
