import fs from 'node:fs'
import path from 'node:path'
import { applyChanges, planChanges, renderChanges } from './changes.js'
import { detectProject } from './detect.js'

// FR-9: undo init. Each remover proposes edits (`after: null` deletes a file init left
// holding nothing else); this function previews them and writes only with `write`.
// Directories init creates for client configs are removed when they end up empty.
export const KIT_DIRECTORIES = ['.claude', '.codex', '.cursor']

function emptyAfter(root, dir, deleted) {
  const absolute = path.join(root, dir)
  let entries
  try {
    entries = fs.readdirSync(absolute)
  } catch {
    return false
  }
  return entries.every((entry) => deleted.has(path.join(absolute, entry)))
}

export function runRemove({
  root,
  write = false,
  components = [],
  removers = [],
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    stderr.write(`Not a directory: ${root}\n`)
    return 1
  }
  const project = detectProject(root)
  const context = { components, notes: [], warnings: [] }
  const changes = planChanges(
    project.root,
    removers.flatMap((remove) => remove(project, context))
  )
  const deleted = new Set(
    changes.filter(({ after }) => after === null).map(({ absolute }) => absolute)
  )
  const directories = KIT_DIRECTORIES.filter(
    (dir) => deleted.size > 0 && emptyAfter(project.root, dir, deleted)
  )

  if (changes.length === 0) {
    stdout.write('Nothing to remove.\n')
    return 0
  }
  stdout.write(`\n${renderChanges(changes)}\n`)
  const files = [
    ...changes.map(({ file, after }) => `  ${file}${after === null ? ' (deleted)' : ''}`),
    ...directories.map((dir) => `  ${dir}/ (empty directory, deleted)`),
  ].join('\n')
  for (const note of context.notes) stdout.write(`Note: ${note}\n`)
  if (!write) {
    stdout.write(`Preview only; nothing was written. Would change:\n${files}\n`)
    stdout.write('Run again with --write to apply.\n')
    return 0
  }
  applyChanges(changes)
  for (const dir of directories) fs.rmdirSync(path.join(project.root, dir))
  stdout.write(`Removed:\n${files}\n`)
  return 0
}
