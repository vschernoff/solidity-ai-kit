import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseDocument } from 'yaml'
import { listCandidates } from '../lib/candidates.js'
import { EVAL_ROOT, readDeps } from '../lib/fixtures.js'

const workflowFile = path.join(EVAL_ROOT, '..', '.github', 'workflows', 'EVAL.yml')
const document = parseDocument(fs.readFileSync(workflowFile, 'utf8'), { uniqueKeys: true })
const workflow = document.toJS()
const steps = workflow.jobs.fixtures.steps
const deps = readDeps()

describe('EVAL.yml', () => {
  it('parses as YAML (NFR-3)', () => {
    assert.deepEqual(document.errors, [])
  })

  it('cancels superseded PR runs but never runs on main (D25)', () => {
    assert.match(
      workflow.concurrency.group,
      /github\.event\.pull_request\.number \|\| github\.sha \}\}$/
    )
    // A ref-wide key would let a newer push to main replace the pending run of an earlier one.
    assert.doesNotMatch(workflow.concurrency.group, /github\.ref/)
    assert.equal(
      workflow.concurrency['cancel-in-progress'],
      "${{ github.event_name == 'pull_request' }}"
    )
  })

  it('runs on Linux only (D16)', () => {
    // A pinned Linux image, never a moving label: results must not change with the runner.
    for (const job of Object.values(workflow.jobs)) assert.equal(job['runs-on'], 'ubuntu-24.04')
  })

  it('installs exactly the Foundry pinned in deps.json, by action commit', () => {
    const { toolchainAction, version } = deps.foundry
    const step = steps.find((s) => s.uses?.startsWith(`${toolchainAction.repo}@`))
    assert.equal(step.uses, `${toolchainAction.repo}@${toolchainAction.commit}`)
    assert.equal(step.with.version, version)
  })

  it('fetches dependencies before confirming ground truth, and keeps the report', () => {
    const runs = steps.map((s) => s.run ?? s.uses ?? '')
    const fetchAt = runs.findIndex((r) => r.includes('eval/scripts/fetch-deps.mjs'))
    const confirmAt = runs.findIndex((r) => r.includes('eval/scripts/confirm-ground-truth.mjs'))
    assert.ok(fetchAt >= 0 && confirmAt > fetchAt)
    assert.ok(runs.some((r) => r.startsWith('actions/upload-artifact@')))
  })

  it('probes every npm candidate, offline, in the image pinned in deps.json', () => {
    const probe = workflow.jobs.probe
    const npmIds = listCandidates()
      .filter((c) => c.install.type === 'npm')
      .map((c) => c.id)
    const include = probe.strategy.matrix.include
    assert.deepEqual([...new Set(include.map((i) => i.candidate))].sort(), npmIds.sort())
    const { image, digest } = deps.probeImage
    assert.equal(probe.env.PROBE_IMAGE, `${image}@${digest}`)
    const script = probe.steps.map((s) => s.run ?? '').join('\n')
    // Only the docker run command itself counts (comments may mention the flags).
    const commands = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .match(/docker run[\s\S]*?\.mjs/g)
    // The probe and the stage cases both run the candidate; both get the same lockdown.
    assert.deepEqual(
      commands?.map((c) => c.match(/scripts\/(\S+\.mjs)/)[1]),
      ['probe.mjs', 'run-cases.mjs']
    )
    for (const dockerRun of commands) {
      for (const flag of [
        '--init',
        '--network none',
        '--read-only',
        '--user 1001:1001',
        '/candidate:ro',
        '"$PROBE_IMAGE"',
      ]) {
        assert.ok(dockerRun.includes(flag), `docker run lacks ${flag}: ${dockerRun}`)
      }
    }
  })

  it('runs every candidate that needs forge once per pinned forge version, toolchain pinned', () => {
    const probe = workflow.jobs.probe
    const include = probe.strategy.matrix.include
    const probed = listCandidates().filter((c) => c.install.type === 'npm')
    for (const candidate of probed.filter((c) => c.requiresBinaries.includes('forge'))) {
      const versions = include.filter((i) => i.candidate === candidate.id).map((i) => i.forge)
      assert.deepEqual(versions.sort(), [...deps.foundry.caseVersions].sort(), candidate.id)
    }
    for (const i of include.filter((x) => x.forge)) {
      assert.ok(
        listCandidates()
          .find((c) => c.id === i.candidate)
          .requiresBinaries.includes('forge'),
        `${i.candidate} gets forge without needing it`
      )
    }
    const { toolchainAction } = deps.foundry
    const toolchain = probe.steps.find((s) => s.uses?.startsWith(`${toolchainAction.repo}@`))
    assert.equal(toolchain.uses, `${toolchainAction.repo}@${toolchainAction.commit}`)
    assert.equal(toolchain.with.version, '${{ matrix.forge }}')
    const script = probe.steps.map((s) => s.run ?? '').join('\n')
    assert.match(script, /fetch-solc\.mjs/)
    // The case runner reads SAK_SOLC ($ENV: in eval/cases/build-test.json) inside the container.
    assert.match(script, /-e SAK_SOLC=\/toolchain\/solc/)
    assert.match(script, /\$FORGE_DIR:\/foundry:ro/)
    // Every forge version a job installs has a pinned binary digest, and the job checks it.
    for (const version of deps.foundry.caseVersions)
      assert.match(deps.foundry.forgeLinuxAmd64Sha256[version] ?? '', /^[0-9a-f]{64}$/, version)
    assert.match(script, /forgeLinuxAmd64Sha256\[process\.env\.FORGE_VERSION\]/)
    assert.match(script, /sha256sum "\$forge_bin"/)
    // The mounted directory must hold the binary itself, not a symlink to elsewhere.
    assert.match(script, /readlink -f "\$\(command -v forge\)"/)
  })

  it('has read-only permissions', () => {
    assert.deepEqual(workflow.permissions, { contents: 'read' })
  })
})
