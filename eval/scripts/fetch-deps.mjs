#!/usr/bin/env node
// Puts forge-std, at the commit pinned in eval/deps.json, into lib/forge-std of every Foundry
// fixture. The tarball is checked against its sha256 before anything is extracted.
//
//   node eval/scripts/fetch-deps.mjs          fetch, verify, install
//   node eval/scripts/fetch-deps.mjs --check  only check every fixture has the pinned copy
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { foundryFixtures, readDeps } from '../lib/fixtures.js'

const run = promisify(execFile)
const { forgeStd } = readDeps()
const PIN_FILE = '.pinned-commit'
const KEEP = ['src', 'LICENSE-MIT', 'LICENSE-APACHE']

function fail(message) {
  console.error(`fetch-deps: ${message}`)
  process.exit(1)
}

function check() {
  const problems = []
  for (const { name, dir } of foundryFixtures()) {
    const pin = path.join(dir, 'lib', 'forge-std', PIN_FILE)
    const found = fs.existsSync(pin) ? fs.readFileSync(pin, 'utf8').trim() : 'missing'
    if (found !== forgeStd.commit) problems.push(`${name}: forge-std ${found}`)
  }
  if (problems.length) fail(`not at ${forgeStd.commit}:\n  ${problems.join('\n  ')}`)
  console.error(`fetch-deps: every Foundry fixture has forge-std ${forgeStd.tag}`)
}

async function install() {
  const response = await fetch(forgeStd.url)
  if (!response.ok) fail(`GET ${forgeStd.url} → HTTP ${response.status}`)
  const tarball = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(tarball).digest('hex')
  if (digest !== forgeStd.sha256) {
    fail(`sha256 mismatch for forge-std ${forgeStd.tag}: got ${digest}, pinned ${forgeStd.sha256}`)
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sak-forge-std-'))
  try {
    const archive = path.join(work, 'forge-std.tar.gz')
    fs.writeFileSync(archive, tarball)
    await run('tar', ['-xzf', archive, '-C', work])
    const root = path.join(work, `forge-std-${forgeStd.commit}`)
    if (!fs.existsSync(path.join(root, 'src', 'Test.sol'))) fail('unexpected tarball layout')

    for (const { name, dir } of foundryFixtures()) {
      const target = path.join(dir, 'lib', 'forge-std')
      fs.rmSync(target, { recursive: true, force: true })
      fs.mkdirSync(target, { recursive: true })
      for (const entry of KEEP) {
        fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true })
      }
      fs.writeFileSync(path.join(target, PIN_FILE), `${forgeStd.commit}\n`)
      console.error(`fetch-deps: ${name} ← forge-std ${forgeStd.tag}`)
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv.includes('--check')) check()
else await install()
