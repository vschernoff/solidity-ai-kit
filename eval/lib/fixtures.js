import { createHash } from 'node:crypto'
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

/**
 * Value of `--name <value>` in argv, `fallback` when the flag is absent. A flag given without a
 * value (end of argv, or followed by another --flag) is an error, never silently ignored.
 */
export function flagValue(argv, name, fallback = null) {
  const at = argv.indexOf(name)
  if (at < 0) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

export const FORGE_STD_PIN_FILE = '.pinned-commit'
export const FORGE_STD_TREE_FILE = '.tree-sha256'

/** sha256 over every file under `dir` (relative path and content, sorted), marker files excluded. */
export function treeDigest(dir) {
  const hash = createHash('sha256')
  const files = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (![FORGE_STD_PIN_FILE, FORGE_STD_TREE_FILE].includes(entry.name)) files.push(full)
    }
  }
  walk(dir)
  for (const file of files.map((f) => path.relative(dir, f)).sort()) {
    hash
      .update(`${file}\0`)
      .update(fs.readFileSync(path.join(dir, file)))
      .update('\0')
  }
  return hash.digest('hex')
}

/**
 * What is wrong with lib/forge-std in each fixture directory: missing, at another commit, or
 * changed since fetch-deps.mjs installed it from the sha256-checked tarball. Empty when sound.
 */
export function forgeStdProblems(dirs, commit = readDeps().forgeStd.commit) {
  const problems = []
  for (const dir of dirs) {
    const name = path.basename(dir)
    const lib = path.join(dir, 'lib', 'forge-std')
    const read = (file) =>
      fs.existsSync(path.join(lib, file))
        ? fs.readFileSync(path.join(lib, file), 'utf8').trim()
        : null
    const pin = read(FORGE_STD_PIN_FILE)
    if (pin !== commit) {
      problems.push(`${name}: forge-std ${pin ?? 'missing'}, expected ${commit}`)
      continue
    }
    const recorded = read(FORGE_STD_TREE_FILE)
    if (!recorded || recorded !== treeDigest(lib)) {
      problems.push(`${name}: forge-std files differ from what fetch-deps installed`)
    }
  }
  return problems
}
