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
  const EVENTS = ['pull_request', 'push', 'schedule', 'workflow_dispatch']

  // Evaluates this workflow's own `if:` and matrix expressions for an event. They only use
  // github.event_name, ==, !=, &&, ||, parentheses, string literals and fromJSON, which map
  // one-to-one onto JavaScript.
  function evaluate(expression, event) {
    if (expression === undefined) return true
    const body = expression
      .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
      .replaceAll('github.event_name', JSON.stringify(event))
      .replaceAll('fromJSON', 'JSON.parse')
      .replaceAll(' == ', ' === ')
      .replaceAll(' != ', ' !== ')
    assert.match(body, /^[\w\s"'(),.[\]=!&|-]+$/, `unexpected expression: ${expression}`)
    return new Function(`return (${body})`)()
  }

  // Which platforms each event tests on: the npm test jobs, and the packed smoke job.
  function platforms(event) {
    const { jobs } = tests()
    const testJobs = ['linux', 'windows', 'macos'].filter((name) => evaluate(jobs[name].if, event))
    return {
      test: testJobs.map((name) => jobs[name]['runs-on']).sort(),
      packed: [...evaluate(jobs.packed.strategy.matrix.os, event)].sort(),
    }
  }

  it('tests every supported Node line on every platform (NFR-1)', () => {
    const { jobs } = tests()
    const floor = Number(readPackageJson().engines.node.match(/^>=(\d+)/)[1])
    for (const name of ['linux', 'windows', 'macos']) {
      const { node } = jobs[name].strategy.matrix
      assert.ok(node.includes(floor), `${name} misses the engines floor, Node ${floor}`)
      // Both supported LTS lines (C11), written out so dropping one fails here.
      assert.deepEqual([...node].sort(), [22, 24], name)
      // The test jobs run the same steps, so the platforms differ only in where they run.
      assert.deepEqual(jobs[name].steps, jobs.linux.steps, name)
    }
    assert.ok(jobs.linux.steps.some(({ run }) => run === 'npm test'))
    const all = ['macos-latest', 'ubuntu-latest', 'windows-latest']
    assert.deepEqual(platforms('schedule').test, all)
    assert.deepEqual(platforms('schedule').packed, all)
  })

  it('runs Linux on pull requests, adds Windows on main, macOS only nightly and on demand (D25, D30)', () => {
    const expected = {
      pull_request: ['ubuntu-latest'],
      push: ['ubuntu-latest', 'windows-latest'],
      schedule: ['macos-latest', 'ubuntu-latest', 'windows-latest'],
      workflow_dispatch: ['macos-latest', 'ubuntu-latest', 'windows-latest'],
    }
    for (const event of EVENTS) {
      assert.deepEqual(platforms(event), { test: expected[event], packed: expected[event] }, event)
    }
    const workflow = tests()
    assert.deepEqual(workflow.on.push.branches, ['main'])
    assert.ok('pull_request' in workflow.on && 'workflow_dispatch' in workflow.on)
    assert.match(workflow.on.schedule[0].cron, /^\S+ \S+ \* \* \*$/, 'a daily schedule')
    assert.equal(workflow.jobs.lint.if, undefined, 'lint runs on every event')
  })

  it('cancels superseded pull request runs but never cancels on main (D25)', () => {
    const { concurrency } = tests()
    assert.match(concurrency.group, /github\.event\.pull_request\.number/)
    // Outside pull requests the group is per commit: GitHub replaces a pending run in the
    // same group even without cancel-in-progress, so a ref-wide group could drop one.
    assert.match(concurrency.group, /\|\| github\.sha \}\}$/)
    assert.doesNotMatch(concurrency.group, /github\.ref/)
    assert.equal(concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  })

  it('runs the packed smoke test (NFR-2)', () => {
    const { packed } = tests().jobs
    assert.ok(packed.steps.some(({ run }) => run === 'npm run test:packed'))
    assert.equal(readPackageJson().scripts['test:packed'], 'node test/packed-smoke.js')
  })
})
