import fs from 'node:fs'
import path from 'node:path'

export const EVAL_ROOT = path.resolve(import.meta.dirname, '..')
export const FIXTURES_DIR = path.join(EVAL_ROOT, 'fixtures')
export const SHARED_DIR = path.join(FIXTURES_DIR, '_shared')

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function readDeps() {
  return readJson(path.join(EVAL_ROOT, 'deps.json'))
}

/** Every fixture directory (F01-…, F02-…), with its parsed GROUND_TRUTH.json. */
export function listFixtures() {
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^F\d{2}-/.test(entry.name))
    .map((entry) => {
      const dir = path.join(FIXTURES_DIR, entry.name)
      return { name: entry.name, dir, groundTruth: readJson(path.join(dir, 'GROUND_TRUTH.json')) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Fixtures that forge can build: layout `foundry` or `both`. */
export function foundryFixtures() {
  return listFixtures().filter(({ groundTruth }) => groundTruth.layout !== 'hardhat')
}

/** Project files of a fixture (relative paths), skipping fetched dependencies and build output. */
export function fixtureFiles(dir) {
  const skip = new Set(['out', 'cache', 'node_modules', 'crytic-export'])
  const files = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full)
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || rel === path.join('lib', 'forge-std')) continue
        walk(full)
      } else {
        files.push(rel)
      }
    }
  }
  walk(dir)
  return files.sort()
}
