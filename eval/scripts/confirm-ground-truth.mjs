#!/usr/bin/env node
// Runs the pinned forge on every Foundry fixture and checks the build, test and storage-layout
// expectations in GROUND_TRUTH.json. Exit 1 on any mismatch, or if forge is not the pinned
// version (use --allow-drift to look anyway; such a run is never evidence).
//
//   node eval/scripts/fetch-deps.mjs && node eval/scripts/confirm-ground-truth.mjs [--out file]
//        [--forge /abs/path/to/forge]   use that binary instead of `forge` on PATH
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { foundryFixtures, readDeps } from '../lib/fixtures.js'
import {
  compareBuild,
  compareCreatedFiles,
  compareStorageLayout,
  compareTests,
  mismatch,
} from '../lib/forge-results.js'

const TIMEOUT_MS = 300_000
const deps = readDeps()
const args = process.argv.slice(2)
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const forgeBin = args.includes('--forge') ? args[args.indexOf('--forge') + 1] : 'forge'

// Allow-list, not deny-list: no keys, RPC URLs or tokens reach forge (eval-design §2).
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  TZ: 'UTC',
  NO_COLOR: '1',
  CI: '1',
}

function forge(argv, cwd) {
  return new Promise((resolve) => {
    execFile(
      forgeBin,
      argv,
      { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let exitCode = 0
        if (error) exitCode = typeof error.code === 'number' ? error.code : -1
        if (error?.killed) stderr += `\n[killed after ${TIMEOUT_MS} ms]`
        if (error?.code === 'ENOENT') stderr += `\n[${forgeBin} not found]`
        resolve({ exitCode, stdout, stderr })
      }
    )
  })
}

const version = await forge(['--version'], process.cwd())
const wanted = deps.foundry.version.replace(/^v/, '')
if (version.exitCode !== 0) {
  console.error(`confirm: cannot run forge: ${version.stderr.trim()}`)
  process.exit(1)
}
const drift = !version.stdout.includes(wanted)
if (drift && !args.includes('--allow-drift')) {
  console.error(`confirm: forge is not ${deps.foundry.version}:\n${version.stdout}`)
  process.exit(1)
}

const report = { forge: version.stdout.trim(), drift, fixtures: {} }
let mismatches = 0

for (const { name, dir, groundTruth } of foundryFixtures()) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `sak-${groundTruth.id}-`))
  const project = path.join(work, name)
  fs.cpSync(dir, project, { recursive: true })
  const results = []
  try {
    const { expect } = groundTruth
    const build = await forge(['build', '--json'], project)
    results.push(...compareBuild(expect.build, build))
    const test = await forge(['test', '--json'], project)
    results.push(...compareTests(expect.test, test))
    results.push(...compareCreatedFiles(expect.test, project))
    if (expect.storageLayout) {
      const layouts = {}
      for (const contract of Object.keys(expect.storageLayout)) {
        if (['label', 'note'].includes(contract)) continue
        layouts[contract] = (
          await forge(['inspect', contract, 'storageLayout', '--json'], project)
        ).stdout
      }
      results.push(...compareStorageLayout(expect.storageLayout, layouts))
    }
  } catch (error) {
    results.push(mismatch('harness', String(error?.stack ?? error)))
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  report.fixtures[name] = results
  for (const result of results) {
    if (result.status === 'mismatch') mismatches += 1
    console.error(
      `${result.status === 'confirmed' ? 'ok  ' : 'FAIL'} ${name}: ${result.check} — ${result.detail}`
    )
  }
}

report.mismatches = mismatches
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
console.error(`confirm: ${mismatches} mismatch(es)${drift ? ' (version drift: not evidence)' : ''}`)
process.exit(mismatches || drift ? 1 : 0)
