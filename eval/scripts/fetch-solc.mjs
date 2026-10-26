#!/usr/bin/env node
// Puts the Linux solc pinned in eval/deps.json at <dir>/solc, for the build/test stage cases in
// the no-network container (they point FOUNDRY_SOLC at it). The download is checked against
// its sha256 before it is written.
//
//   node eval/scripts/fetch-solc.mjs <dir>
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readDeps } from '../lib/fixtures.js'

const { solcLinux } = readDeps()
const dir = process.argv[2]
if (!dir) {
  console.error('usage: fetch-solc.mjs <dir>')
  process.exit(2)
}

const response = await fetch(solcLinux.url)
if (!response.ok) {
  console.error(`fetch-solc: GET ${solcLinux.url} → HTTP ${response.status}`)
  process.exit(1)
}
const binary = Buffer.from(await response.arrayBuffer())
const digest = createHash('sha256').update(binary).digest('hex')
if (digest !== solcLinux.sha256) {
  console.error(`fetch-solc: sha256 ${digest}, expected ${solcLinux.sha256}`)
  process.exit(1)
}
fs.mkdirSync(dir, { recursive: true })
const target = path.join(dir, 'solc')
fs.writeFileSync(target, binary, { mode: 0o755 })
console.error(`fetch-solc: solc ${solcLinux.version} → ${target} (sha256 ok)`)
