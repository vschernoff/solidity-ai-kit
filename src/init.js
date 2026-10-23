import { detectProject } from './detect.js'
import { applyChanges, planChanges, renderChanges } from './changes.js'

// Generators turn the detected project into file edits ({ file, after }). The client
// config writers (FR-3…FR-9) and the workflow-rules block (FR-6) are added here as they
// land; each one only proposes edits, and this function alone decides whether to write.
export const DEFAULT_GENERATORS = []

function describe(project) {
  const markers = project.markers.length > 0 ? ` (${project.markers.join(', ')})` : ''
  return `Project: ${project.kind}${markers} at ${project.root}`
}

export function runInit({
  root,
  write = false,
  generators = DEFAULT_GENERATORS,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
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

  const changes = planChanges(
    project.root,
    generators.flatMap((generate) => generate(project))
  )
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
  return 0
}
