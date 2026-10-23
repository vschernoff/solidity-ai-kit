import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseDocument } from 'yaml'
import { PACKAGE_ROOT, readPackageJson } from '../src/manifest.js'

const githubDir = path.join(PACKAGE_ROOT, '.github')
const yamlFiles = fs
  .readdirSync(githubDir, { recursive: true })
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => path.join(githubDir, file))

function parseYaml(file) {
  const document = parseDocument(fs.readFileSync(file, 'utf8'), { uniqueKeys: true })
  assert.deepEqual(document.errors, [], file)
  return document.toJS()
}

describe('GitHub YAML (NFR-3)', () => {
  it('finds the workflow files', () => {
    assert.ok(yamlFiles.some((file) => file.endsWith(path.join('workflows', 'TESTS.yml'))))
  })

  for (const file of yamlFiles) {
    it(`parses ${path.relative(PACKAGE_ROOT, file)}`, () => {
      assert.equal(typeof parseYaml(file), 'object')
    })
  }

  it('tests every supported Node line on every platform (NFR-1)', () => {
    const { matrix } = parseYaml(path.join(githubDir, 'workflows', 'TESTS.yml')).jobs.test.strategy
    const floor = Number(readPackageJson().engines.node.match(/^>=(\d+)/)[1])
    assert.ok(matrix.node.includes(floor), `matrix misses the engines floor, Node ${floor}`)
    assert.ok(matrix.node.every((major) => major >= floor))
    // Both supported LTS lines (C11), written out so dropping one fails here.
    assert.deepEqual([...matrix.node].sort(), [22, 24])
    assert.deepEqual([...matrix.os].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest'])
  })

  it('runs the packed smoke test, Linux-only on pull requests (NFR-2, D25)', () => {
    const { packed } = parseYaml(path.join(githubDir, 'workflows', 'TESTS.yml')).jobs
    assert.ok(packed.steps.some(({ run }) => run === 'npm run test:packed'))
    const os = packed.strategy.matrix.os
    assert.match(os, /github\.event_name == 'pull_request' && '\["ubuntu-latest"\]'/)
    for (const platform of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
      assert.ok(os.includes(`"${platform}"`), platform)
    }
    assert.equal(readPackageJson().scripts['test:packed'], 'node test/packed-smoke.js')
  })
})
