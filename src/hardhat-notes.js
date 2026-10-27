import fs from 'node:fs'
import { resolveInside } from './changes.js'
import { readText } from './clients/json.js'

// D56: notes init prints for a Hardhat-only project. Suggestions only: init never changes
// the project for them.

// The default components that need forge are left out. Hardhat's own way to add Foundry is
// the hardhat-foundry plugin's init-foundry task, documented for Hardhat 2.
const HARDHAT_FOUNDRY_DOCS =
  'https://v2.hardhat.org/hardhat-runner/docs/advanced/hardhat-and-foundry'

function foundryNote(manifest, components) {
  const leftOut = manifest.components.filter(
    (component) =>
      component.enabledByDefault &&
      component.requiresBinaries.includes('forge') &&
      !components.includes(component)
  )
  if (leftOut.length === 0) return []
  const names = leftOut.map((component) => component.package ?? component.id).join(', ')
  const verb = leftOut.length === 1 ? 'was not set up: it needs' : 'were not set up: they need'
  return [
    `${names} ${verb} Foundry. To add Foundry to a Hardhat project, Hardhat's hardhat-foundry ` +
      `plugin provides \`npx hardhat init-foundry\` (Hardhat 2: ${HARDHAT_FOUNDRY_DOCS}).`,
  ]
}

// Hardhat ships agent skills (MIT) in node_modules/hardhat/skills/ from 3.6.0 on: the core
// `hardhat` skill and one per toolbox. The note is printed only when the installed Hardhat
// has them (a version range in package.json cannot tell 3.5 from 3.6, and before npm
// install nothing is there to copy). Where each client reads project skills: Claude Code
// .claude/skills; Codex and Cursor .agents/skills (Codex and Cursor docs, checked
// 2026-10-27). Only the Claude Code pickup was run.
const SKILL_DIRS = {
  'claude-code': '.claude/skills',
  codex: '.agents/skills',
  cursor: '.agents/skills',
}
const TOOLBOX_SKILLS = {
  '@nomicfoundation/hardhat-toolbox-viem': 'hardhat-toolbox-viem',
  '@nomicfoundation/hardhat-toolbox-mocha-ethers': 'hardhat-toolbox-mocha-ethers',
}

function readPackage(root) {
  try {
    const value = JSON.parse(readText(root, 'package.json') ?? 'null')
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    // Unreadable or not JSON: no toolbox is named, only the core skill.
    return null
  }
}

const CORE_SKILL = 'node_modules/hardhat/skills/hardhat/SKILL.md'

// Read only inside the project: a path that leaves it, through a symlink or otherwise,
// counts as absent.
function isInstalled(root, file) {
  try {
    return fs.statSync(resolveInside(root, file)).isFile()
  } catch {
    return false
  }
}

function skillsNote(root, clients) {
  if (!isInstalled(root, CORE_SKILL)) return []
  const pkg = readPackage(root) ?? {}
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies }
  const skills = [
    'hardhat',
    ...Object.entries(TOOLBOX_SKILLS)
      .filter(([dependency]) => Object.hasOwn(dependencies, dependency))
      .map(([, skill]) => skill)
      .filter((skill) => isInstalled(root, `node_modules/hardhat/skills/${skill}/SKILL.md`)),
  ]
  const sources = skills.map((skill) => `node_modules/hardhat/skills/${skill}`).join(' ')
  const dirs = [...new Set(clients.map((client) => SKILL_DIRS[client]))].sort()
  return [
    [
      'Hardhat 3 ships agent skills for its testing workflow (MIT). The kit does not copy them; ' +
        'to use them, run in a POSIX shell (and re-copy after upgrading Hardhat):',
      ...dirs.map((dir) => `  mkdir -p ${dir} && cp -R ${sources} ${dir}/`),
    ].join('\n'),
  ]
}

export function hardhatNotes({ manifest, components, project, clients }) {
  if (project.kind !== 'hardhat') return []
  return [...foundryNote(manifest, components), ...skillsNote(project.root, clients)]
}
