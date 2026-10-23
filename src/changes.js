import fs from 'node:fs'
import path from 'node:path'
import { unifiedDiff } from './diff.js'

// FR-2 and NFR-4: every command that edits files first builds a list of changes, prints
// them as a diff, and writes only when asked. Writes stay inside the project root.

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// Unlike fs.existsSync, true for a dangling symlink too.
function lexists(file) {
  try {
    fs.lstatSync(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function escapes(fromRoot) {
  return fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)
}

function toPosix(relative) {
  return relative.split(path.sep).join('/')
}

/**
 * Resolves `relative` against `root` and refuses anything that would land outside it,
 * including through a symlinked file or directory.
 */
export function resolveInside(root, relative) {
  const absolute = path.resolve(root, relative)
  const fromRoot = path.relative(root, absolute)
  if (fromRoot === '' || escapes(fromRoot)) {
    throw new Error(`Refusing to write outside the project: ${relative}`)
  }

  const realRoot = fs.realpathSync(root)
  let existing = absolute
  while (!lexists(existing)) existing = path.dirname(existing)
  if (existing === absolute && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing to write through a symlink: ${relative}`)
  }
  const realExisting = fs.realpathSync(existing)
  const realFromRoot = path.relative(realRoot, realExisting)
  if (escapes(realFromRoot)) {
    throw new Error(`Refusing to write outside the project (via a symlink): ${relative}`)
  }
  return absolute
}

/**
 * One planned edit. `after: null` deletes the file. Changes that would leave the file as it
 * is are dropped, so an empty plan means there is nothing to do.
 */
export function planChanges(root, edits) {
  const changes = []
  for (const { file, after } of edits) {
    const absolute = resolveInside(root, file)
    const before = readOrNull(absolute)
    if (before === after) continue
    changes.push({ file: toPosix(path.relative(root, absolute)), absolute, before, after })
  }
  return changes
}

export function renderChanges(changes) {
  return changes.map(({ file, before, after }) => unifiedDiff(file, before, after)).join('')
}

/**
 * Writes the planned changes. Before touching anything it checks that no file changed
 * since the plan was made, so a concurrent edit is never silently overwritten.
 */
export function applyChanges(changes) {
  for (const { file, absolute, before } of changes) {
    if (readOrNull(absolute) !== before) {
      throw new Error(`${file} changed since the preview; nothing was written. Run again.`)
    }
  }
  for (const { absolute, after } of changes) {
    if (after === null) {
      fs.rmSync(absolute, { force: true })
      continue
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    // Write beside the target, then rename over it, so a crash never leaves half a file.
    const temporary = `${absolute}.solidity-ai-kit-${process.pid}.tmp`
    fs.writeFileSync(temporary, after)
    fs.renameSync(temporary, absolute)
  }
}
