import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'
import { loadManifest } from '../../src/manifest.js'
import {
  CANARIES,
  CANDIDATES_DIR,
  candidateEnv,
  candidateVersion,
  launchCommand,
  leakedCanaries,
  lifecycleScripts,
  listCandidates,
} from '../lib/candidates.js'
import { EVAL_ROOT, readJson } from '../lib/fixtures.js'

const run = promisify(execFile)
const candidates = listCandidates()
const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(
  readJson(path.join(CANDIDATES_DIR, 'candidate.schema.json'))
)
const STUB = path.join(import.meta.dirname, 'support', 'stub-server.mjs')

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** A fake npm install whose bin is the stub server, as install-candidate.mjs would lay it out. */
function fakeNpmInstall(stubFlags = []) {
  const dir = tempDir('sak-install-')
  const pkgDir = path.join(dir, 'node_modules', 'stub-mcp')
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'stub-mcp', version: '1.0.0', bin: { 'stub-mcp': 'bin.mjs' } })
  )
  fs.writeFileSync(
    path.join(pkgDir, 'bin.mjs'),
    `process.argv.push(...${JSON.stringify(stubFlags)})\nawait import(${JSON.stringify(STUB)})\n`
  )
  const candidate = {
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
    deniedTools: ['cast_send'],
  }
  const candidateFile = path.join(dir, 'candidate.json')
  fs.writeFileSync(candidateFile, JSON.stringify(candidate))
  return { dir, candidate, candidateFile }
}

async function probeScript(stubFlags) {
  const { dir, candidateFile } = fakeNpmInstall(stubFlags)
  const out = path.join(dir, 'report.json')
  await run(process.execPath, [
    path.join(EVAL_ROOT, 'scripts', 'probe.mjs'),
    'stub-mcp',
    dir,
    '--out',
    out,
    '--candidate-file',
    candidateFile,
    '--timeout-ms',
    '3000',
  ])
  return readJson(out)
}

describe('candidates', () => {
  for (const candidate of candidates) {
    it(`${candidate.id} matches the candidate schema and its file name`, () => {
      assert.ok(validate(candidate), JSON.stringify(validate.errors, null, 2))
      assert.ok(fs.existsSync(path.join(CANDIDATES_DIR, `${candidate.id}.json`)))
    })
  }

  it('covers every manifest component at the manifest version (FR-16: no unevaluated component)', () => {
    for (const component of loadManifest().components) {
      const candidate = candidates.find((c) => c.manifestId === component.id)
      assert.ok(candidate, `no candidate for manifest component ${component.id}`)
      assert.equal(candidate.install.package, component.package)
      assert.equal(candidateVersion(candidate), component.version)
      assert.deepEqual(candidate.deniedTools, component.deniedTools)
    }
  })

  it('gives candidates only allow-listed variables plus canaries', () => {
    const env = candidateEnv('/tmp/h')
    assert.deepEqual(Object.keys(env).sort(), [
      'CI',
      'ETHERSCAN_API_KEY',
      'HOME',
      'LANG',
      'NO_COLOR',
      'PATH',
      'PRIVATE_KEY',
      'RPC_URL',
      'TMPDIR',
      'TZ',
    ])
    for (const [name, value] of Object.entries(CANARIES)) assert.equal(env[name], value)
    assert.deepEqual(leakedCanaries(`x ${CANARIES.RPC_URL} y`), ['RPC_URL'])
  })

  it('resolves an npm candidate to node plus its bin, with the candidate args', () => {
    const { dir, candidate } = fakeNpmInstall()
    const launch = launchCommand({ ...candidate, args: ['--flag'] }, dir)
    assert.equal(launch.command, process.execPath)
    assert.deepEqual(launch.args, [path.join(dir, 'node_modules', 'stub-mcp', 'bin.mjs'), '--flag'])
  })

  it('finds lifecycle scripts anywhere in a dependency tree (gate G5)', () => {
    const root = tempDir('sak-nm-')
    const write = (rel, pkg) => {
      fs.mkdirSync(path.join(root, rel), { recursive: true })
      fs.writeFileSync(path.join(root, rel, 'package.json'), JSON.stringify(pkg))
    }
    write('clean', { name: 'clean', version: '1.0.0', scripts: { test: 'x', prepare: 'x' } })
    write('@scope/hooked', {
      name: '@scope/hooked',
      version: '2.0.0',
      scripts: { postinstall: 'x' },
    })
    write('clean/node_modules/deep', {
      name: 'deep',
      version: '3.0.0',
      scripts: { preinstall: 'x' },
    })
    assert.deepEqual(
      lifecycleScripts(root).map((f) => [f.package, f.scripts]),
      [
        ['@scope/hooked@2.0.0', ['postinstall']],
        ['deep@3.0.0', ['preinstall']],
      ]
    )
  })
})

describe('probe.mjs end to end', () => {
  it('reports a healthy candidate, a stale deny-list entry, and no home writes', async () => {
    const report = await probeScript([])
    assert.equal(report.probe.healthy, true)
    assert.equal(report.probe.toolCount, 2)
    assert.deepEqual(report.findings, [
      { gate: 'FR-7', finding: 'deniedTools not exposed: cast_send' },
    ])
    assert.deepEqual(report.homeWrites, [])
  })

  it('catches a server that leaks the canary private key (G7)', async () => {
    const report = await probeScript(['--leak-key'])
    assert.ok(report.findings.some((f) => f.gate === 'G7' && f.finding.includes('PRIVATE_KEY')))
  })

  it('records a hang as a C4 finding and still writes the report', async () => {
    const report = await probeScript(['--hang-tools-list'])
    assert.equal(report.probe.healthy, false)
    assert.ok(report.findings.some((f) => f.gate === 'C4' && f.finding.includes('tools/list')))
  })
})
