import fs from 'node:fs'
import { applyChanges, planChanges, renderChanges } from './changes.js'
import { detectProject } from './detect.js'

// Generators turn the detected project into proposed file edits ({ file, after }). The
// client writers live in src/clients/; each one only proposes edits, and this function
// alone decides whether to write. Generators may add `notes` and `warnings` for the user.

function describe(project) {
  const markers = project.markers.length > 0 ? ` (${project.markers.join(', ')})` : ''
  return `Project: ${project.kind}${markers} at ${project.root}`
}

export function runInit({
  root,
  write = false,
  components = [],
  generators = [],
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    stderr.write(`Not a directory: ${root}\n`)
    return 1
  }
  const project = detectProject(root)
  if (project.kind === 'none' && project.parentProject !== null) {
    stderr.write(
      `No foundry.toml or hardhat.config.* here, but ${project.parentProject} has one.\n` +
        'Run init from the project root, so configs land where the tools look for them.\n'
    )
    return 1
  }

  stdout.write(`${describe(project)}\n`)
  if (project.kind === 'none') {
    stdout.write('No foundry.toml or hardhat.config.* found; continuing without one.\n')
  }

  const context = { components, notes: [], warnings: [] }
  const changes = planChanges(
    project.root,
    generators.flatMap((generate) => generate(project, context))
  )
  for (const warning of context.warnings) stderr.write(`Warning: ${warning}\n`)

  if (changes.length === 0) {
    stdout.write('Nothing to change.\n')
    return 0
  }

  stdout.write(`\n${renderChanges(changes)}\n`)
  const files = changes.map(({ file }) => `  ${file}`).join('\n')
  if (!write) {
    stdout.write(`Preview only; nothing was written. Files that would change:\n${files}\n`)
    stdout.write('Run again with --write to apply.\n')
    return 0
  }
  applyChanges(changes)
  stdout.write(`Wrote:\n${files}\n`)
  for (const note of context.notes) stdout.write(`Note: ${note}\n`)
  return 0
}
