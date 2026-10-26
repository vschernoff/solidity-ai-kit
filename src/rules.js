import fs from 'node:fs'
import path from 'node:path'
import { label } from './components.js'
import { readText } from './clients/json.js'

// FR-6 and FR-18…FR-23: the workflow rules init writes into the agent instruction files,
// inside a delimited block that init owns and rewrites. Everything outside the block is
// the user's. The text names only what this project actually has (FR-23): its own build
// tool, and the components init installed.

export const START = '<!-- solidity-ai-kit:start -->'
export const END = '<!-- solidity-ai-kit:end -->'

// Which instruction file each client reads (vendor docs checked 2026-10-23: Claude Code
// reads CLAUDE.md; Codex and Cursor read AGENTS.md).
export const RULES_FILES = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md', cursor: 'AGENTS.md' }

const BUILD_AND_TEST = {
  foundry: '`forge build` and `forge test`',
  hardhat: '`npx hardhat compile` and `npx hardhat test`',
  both: '`forge build` and `forge test` (or `npx hardhat compile` and `npx hardhat test`)',
  none: "the project's build and test commands",
}

function serverName(component) {
  return `the \`${component.id}\` MCP server`
}

// Build and test through a build-test server where it can run them: Foundry projects (the
// server runs forge). Tool names as forge-test-mcp 0.1.0 lists them.
function buildAndTest(project, buildTest) {
  if (buildTest.length === 0 || (project.kind !== 'foundry' && project.kind !== 'both')) {
    return [
      `After changing Solidity, build and run the relevant tests with ${BUILD_AND_TEST[project.kind]}. Fix failures first.`,
    ]
  }
  const hardhat =
    project.kind === 'both'
      ? ' For Hardhat tests use `npx hardhat compile` and `npx hardhat test`.'
      : ''
  return [
    `After changing Solidity, build and run the relevant tests with the \`build\` and \`run_tests\` tools of ${buildTest.map(serverName).join(' and ')}; use \`forge build\` or \`forge test\` in a shell only when the tool cannot run.${hardhat} Fix failures first.`,
    'When a test tool reports an error, the tests did not run: fix the cause and run them again. Never report that as passing, even if it shows 0 failed.',
  ]
}

export function rulesBlock(project, components) {
  const byStage = (stage) => components.filter((component) => component.stage === stage)
  const buildTest = byStage('build-test')
  const lint = byStage('lint')
  const fuzz = byStage('fuzz')
  const installed =
    components.length > 0
      ? components.map((component) => `\`${label(component)}\` (${component.stage})`).join(', ')
      : 'none'

  const steps = buildAndTest(project, buildTest)
  if (lint.length > 0) {
    steps.push(
      `Then lint with ${lint.map(serverName).join(' and ')}. Use its fix tools for auto-fixable findings.`
    )
  }
  steps.push(
    `Repeat until tests pass${lint.length > 0 ? ' and lint shows no errors' : ''}. Stop after 5 rounds and report what remains.`,
    'Never make a check pass by weakening it: no comments that switch lint rules off, no skipped or deleted tests, no lowered fuzz runs, no loosened configs, unless the user agrees.',
    `For contracts that hold value, write fuzz or invariant tests${
      fuzz.length > 0 ? `; run them with ${fuzz.map(serverName).join(' and ')} when configured` : ''
    }.`,
    'Passing tests and a clean lint do not prove a contract is secure. Say so when reporting, and recommend an independent audit before value is deployed.',
    'Never send transactions, deploy, or handle private keys. Leave that to the user.'
  )

  return [
    START,
    '## Solidity workflow',
    '',
    `Tools installed by solidity-ai-kit: ${installed}.`,
    '',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'This block is rewritten by `solidity-ai-kit init`; edit outside it.',
    END,
  ]
}

// Returns the file with the block inserted or replaced. A file with a damaged block (one
// marker without the other, markers out of order, or more than one block) is an error:
// guessing where the user's text ends could delete it.
// Where the kit's block is in `lines`: null when there is none. A damaged block (one
// marker without the other, markers out of order, or more than one block) is an error:
// guessing where the user's text ends could delete it.
function findBlock(file, lines) {
  // Markers quoted inside a fenced code block are examples, not the kit's block.
  let fenced = false
  const markerAt = lines.map((line) => {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced
    return fenced ? null : line.trim()
  })
  const starts = markerAt.flatMap((marker, index) => (marker === START ? [index] : []))
  const ends = markerAt.flatMap((marker, index) => (marker === END ? [index] : []))
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error(
      `${file} has a damaged solidity-ai-kit block (${starts.length} start, ${ends.length} end marker(s)). ` +
        `Fix or remove the ${START} … ${END} lines, then run the kit again.`
    )
  }
  return { start: starts[0], end: ends[0] }
}

// Returns the file with the block inserted or replaced.
export function withBlock(file, text, block) {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const blockText = block.join(eol)
  if (text === null || text === '') return `${blockText}${eol}`

  const lines = text.split(/\r?\n/)
  const found = findBlock(file, lines)
  if (found === null) {
    const body = text.replace(/(\r?\n)*$/, '')
    return `${body}${eol}${eol}${blockText}${eol}`
  }
  return [...lines.slice(0, found.start), ...block, ...lines.slice(found.end + 1)].join(eol)
}

// FR-9: the file without the block (and the blank line init put before it); `null` when
// nothing else is left, `undefined` when there is no block.
export function withoutBlock(file, text) {
  if (text === null) return undefined
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const found = findBlock(file, lines)
  if (found === null) return undefined
  const before = lines.slice(0, found.start)
  if (before.length > 0 && before.at(-1).trim() === '') before.pop()
  const rest = [...before, ...lines.slice(found.end + 1)]
  const joined = rest.join(eol).replace(/(\r?\n)*$/, '')
  return joined.trim() === '' ? null : `${joined}${eol}`
}

// A common layout makes CLAUDE.md a symlink to AGENTS.md (or the other way round). When a
// rules file is a symlink to a file inside the project, the block is written once, to the
// target. A symlink that leads outside the project is left for resolveInside to refuse.
function linkTarget(root, file) {
  const absolute = path.join(root, file)
  let stat
  try {
    stat = fs.lstatSync(absolute)
  } catch (error) {
    if (error.code === 'ENOENT') return file
    throw error
  }
  if (!stat.isSymbolicLink()) return file
  const target = path.resolve(fs.realpathSync(path.dirname(absolute)), fs.readlinkSync(absolute))
  const fromRoot = path.relative(fs.realpathSync(root), target)
  const outside =
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRoot)
  return outside ? file : fromRoot
}

export function rulesGenerator(clients) {
  const files = [...new Set(clients.map((client) => RULES_FILES[client]))]
  return function rules(project, { components, notes }) {
    const block = rulesBlock(project, components)
    const targets = new Map()
    for (const file of files) {
      const target = linkTarget(project.root, file)
      if (target !== file)
        notes.push(`${file} is a symlink to ${target}; the rules are written there.`)
      if (!targets.has(target)) targets.set(target, file)
    }
    return [...targets.keys()].map((file) => ({
      file,
      after: withBlock(file, readText(project.root, file), block),
    }))
  }
}

export function rulesRemover(clients) {
  const files = [...new Set(clients.map((client) => RULES_FILES[client]))]
  return function rules(project, { notes }) {
    const targets = new Set()
    for (const file of files) {
      const target = linkTarget(project.root, file)
      if (target !== file)
        notes.push(`${file} is a symlink to ${target}; the block is removed there.`)
      targets.add(target)
    }
    return [...targets].flatMap((file) => {
      const after = withoutBlock(file, readText(project.root, file))
      return after === undefined ? [] : [{ file, after }]
    })
  }
}
