#!/usr/bin/env node
// Installs one candidate, exactly as pinned in eval/candidates/<id>.json, into a directory the
// probe later mounts read-only. Needs the network; the probe that follows does not.
//
//   node eval/scripts/install-candidate.mjs <id> <install-dir>
//
// npm: the registry's tarball must match the pinned sha512 integrity before anything is
// installed; install runs with --ignore-scripts, and every lifecycle script found anywhere in
// the dependency tree is reported (SRS §8.2 gate G5). python-git: uv installs the pinned
// commit with the pinned constraints into a fresh venv.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { lifecycleScripts, readCandidate } from '../lib/candidates.js'

const run = promisify(execFile)
const [id, installDirArg] = process.argv.slice(2)
if (!id || !installDirArg) {
  console.error('usage: install-candidate.mjs <id> <install-dir>')
  process.exit(2)
}
const candidate = readCandidate(id)
const installDir = path.resolve(installDirArg)

function fail(message) {
  console.error(`install-candidate: ${id}: ${message}`)
  process.exit(1)
}

function sri(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`
}

async function installNpm({ package: name, version, integrity }) {
  const metaUrl = `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`
  const meta = await (await fetch(metaUrl)).json()
  if (meta?.dist?.integrity !== integrity) {
    fail(`registry integrity ${meta?.dist?.integrity} != pinned ${integrity}`)
  }
  const tarball = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer())
  if (sri(tarball) !== integrity) fail(`downloaded tarball hashes to ${sri(tarball)}`)

  fs.mkdirSync(installDir, { recursive: true })
  const tarballPath = path.join(installDir, `${id}-${version}.tgz`)
  fs.writeFileSync(tarballPath, tarball)
  fs.writeFileSync(path.join(installDir, 'package.json'), '{ "private": true }\n')
  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', tarballPath],
    { cwd: installDir, maxBuffer: 16 * 1024 * 1024 }
  )
  const tree = await run('npm', ['ls', '--all', '--json'], {
    cwd: installDir,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error) => ({ stdout: error.stdout ?? '{}' }))
  return {
    integrity,
    lifecycleScripts: lifecycleScripts(path.join(installDir, 'node_modules')),
    dependencyTree: JSON.parse(tree.stdout || '{}'),
  }
}

async function installPythonGit({ repo, commit, constraints }) {
  await run('uv', ['venv', installDir])
  const python = path.join(installDir, 'bin', 'python')
  await run('uv', ['pip', 'install', '--python', python, `git+${repo}@${commit}`, ...constraints], {
    maxBuffer: 16 * 1024 * 1024,
  })
  const frozen = await run('uv', ['pip', 'freeze', '--python', python])
  return { commit, constraints, frozen: frozen.stdout.trim().split('\n') }
}

const report = { id, install: candidate.install, installedAt: new Date().toISOString() }
try {
  if (candidate.install.type === 'npm') Object.assign(report, await installNpm(candidate.install))
  else if (candidate.install.type === 'python-git') {
    Object.assign(report, await installPythonGit(candidate.install))
  } else fail(`unknown install type ${candidate.install.type}`)
} catch (error) {
  fail(`${error.message}\n${error.stderr ?? ''}`)
}
fs.writeFileSync(
  path.join(installDir, 'install-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
)
const scripts = report.lifecycleScripts ?? []
console.error(
  `install-candidate: ${id} installed; lifecycle scripts in tree: ${scripts.length ? JSON.stringify(scripts) : 'none'}`
)
