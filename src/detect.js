import fs from 'node:fs'
import path from 'node:path'

// Marker files, as each tool itself looks for them:
// - Foundry: `foundry.toml` (Config::FILE_NAME, foundry-rs/foundry crates/config).
// - Hardhat 3 looks for .ts then .js; Hardhat 2 also accepts .cts and .cjs
//   (NomicFoundation/hardhat: packages/hardhat/src/internal/config-loading.ts on main,
//   packages/hardhat-core/src/internal/core/project-structure.ts on v2).
export const FOUNDRY_MARKERS = ['foundry.toml']
export const HARDHAT_MARKERS = [
  'hardhat.config.ts',
  'hardhat.config.js',
  'hardhat.config.cts',
  'hardhat.config.cjs',
]

function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

function markersIn(dir, names) {
  return names.filter((name) => isFile(path.join(dir, name)))
}

function kindOf(foundry, hardhat) {
  if (foundry && hardhat) return 'both'
  if (foundry) return 'foundry'
  if (hardhat) return 'hardhat'
  return 'none'
}

function detectIn(dir) {
  const foundry = markersIn(dir, FOUNDRY_MARKERS)
  const hardhat = markersIn(dir, HARDHAT_MARKERS)
  return {
    kind: kindOf(foundry.length > 0, hardhat.length > 0),
    foundry: foundry.length > 0,
    hardhat: hardhat.length > 0,
    markers: [...foundry, ...hardhat],
  }
}

// The nearest ancestor holding a marker, not looking past the git root, the same boundary
// forge uses. Only reported, never acted on: configs are written where init was run.
function findParentProject(dir) {
  let current = dir
  while (!fs.existsSync(path.join(current, '.git'))) {
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
    if (detectIn(current).kind !== 'none') return current
  }
  return null
}

/**
 * FR-1: what kind of Solidity project `dir` is, judged by marker files in `dir` itself.
 * When `dir` has none but a parent does, `parentProject` names it so the caller can tell
 * the user to run from there.
 */
export function detectProject(dir) {
  const root = path.resolve(dir)
  const detected = detectIn(root)
  return {
    root,
    ...detected,
    parentProject: detected.kind === 'none' ? findParentProject(root) : null,
  }
}
