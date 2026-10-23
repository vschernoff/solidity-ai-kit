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

  const tests = () => parseYaml(path.join(githubDir, 'workflows', 'TESTS.yml'))

  it('tests every supported Node line on every platform (NFR-1)', () => {
    const { jobs } = tests()
    const floor = Number(readPackageJson().engines.node.match(/^>=(\d+)/)[1])
    for (const job of [jobs.linux, jobs['other-platforms']]) {
      const { node } = job.strategy.matrix
      assert.ok(node.includes(floor), `matrix misses the engines floor, Node ${floor}`)
      // Both supported LTS lines (C11), written out so dropping one fails here.
      assert.deepEqual([...node].sort(), [22, 24])
    }
    const platforms = [jobs.linux['runs-on'], ...jobs['other-platforms'].strategy.matrix.os]
    assert.deepEqual(platforms.sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest'])
    // Both test jobs run the same steps, so the platforms differ only in where they run.
    assert.deepEqual(jobs['other-platforms'].steps, jobs.linux.steps)
    assert.ok(jobs.linux.steps.some(({ run }) => run === 'npm test'))
  })

  it('runs macOS and Windows on main, nightly and on demand, not on pull requests (D25)', () => {
    const workflow = tests()
    assert.deepEqual(workflow.on.push.branches, ['main'])
    assert.ok('pull_request' in workflow.on)
    assert.ok('workflow_dispatch' in workflow.on)
    assert.match(workflow.on.schedule[0].cron, /^\S+ \S+ \* \* \*$/, 'a daily schedule')
    assert.equal(workflow.jobs['other-platforms'].if, "github.event_name != 'pull_request'")
    assert.equal(workflow.jobs.linux.if, undefined)
    assert.equal(workflow.jobs.lint.if, undefined)
  })

  it('cancels superseded pull request runs but never cancels on main (D25)', () => {
    const { concurrency } = tests()
    assert.match(concurrency.group, /github\.event\.pull_request\.number/)
    assert.equal(concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  })
})
