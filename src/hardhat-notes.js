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

// Hardhat 3 ships agent skills (MIT) in node_modules/hardhat/skills/: the core `hardhat`
// skill and one per toolbox. Where each client reads project skills: Claude Code
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

// The major version a dependency range pins, or null when it cannot be told for sure:
// `3`, `3.21.1`, `^3.21.1`, `~3`, `=3.0.0`, `3.x`. Anything else (`>=2`, `*`, `latest`,
// `workspace:*`, `npm:…`, a URL, `2 || 3`) is null, and no note is printed.
export function majorOf(range) {
  if (typeof range !== 'string') return null
  const match = range.trim().match(/^[\^~=]?(\d+)(\.(\d+|x|\*)){0,2}(-[0-9A-Za-z.-]+)?$/)
  return match ? Number(match[1]) : null
}

function readPackage(root) {
  try {
    const value = JSON.parse(readText(root, 'package.json') ?? 'null')
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    // Unreadable or not JSON: say nothing rather than guess the Hardhat version.
    return null
  }
}

function skillsNote(root, clients) {
  const pkg = readPackage(root)
  if (pkg === null) return []
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies }
  const major = majorOf(dependencies.hardhat)
  if (major === null || major < 3) return []
  const skills = [
    'hardhat',
    ...Object.entries(TOOLBOX_SKILLS)
      .filter(([dependency]) => Object.hasOwn(dependencies, dependency))
      .map(([, skill]) => skill),
  ]
  const sources = skills.map((skill) => `node_modules/hardhat/skills/${skill}`).join(' ')
  const dirs = [...new Set(clients.map((client) => SKILL_DIRS[client]))].sort()
  return [
    [
      'Hardhat 3 ships agent skills for its testing workflow (MIT). The kit does not copy them; ' +
        'to use them, run (and re-copy after upgrading Hardhat):',
      ...dirs.map((dir) => `  mkdir -p ${dir} && cp -R ${sources} ${dir}/`),
    ].join('\n'),
  ]
}

export function hardhatNotes({ manifest, components, project, clients }) {
  if (project.kind !== 'hardhat') return []
  return [...foundryNote(manifest, components), ...skillsNote(project.root, clients)]
}
