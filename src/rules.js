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

export function rulesBlock(project, components) {
  const byStage = (stage) => components.filter((component) => component.stage === stage)
  const lint = byStage('lint')
  const fuzz = byStage('fuzz')
  const installed =
    components.length > 0
      ? components.map((component) => `\`${label(component)}\` (${component.stage})`).join(', ')
      : 'none'

  const steps = [
    `After changing Solidity, build and run the relevant tests with ${BUILD_AND_TEST[project.kind]}. Fix failures first.`,
  ]
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
export function withBlock(file, text, block) {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const blockText = block.join(eol)
  if (text === null || text === '') return `${blockText}${eol}`

  const lines = text.split(/\r?\n/)
  // Markers quoted inside a fenced code block are examples, not the kit's block.
  let fenced = false
  const markerAt = lines.map((line) => {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced
    return fenced ? null : line.trim()
  })
  const starts = markerAt.flatMap((marker, index) => (marker === START ? [index] : []))
  const ends = markerAt.flatMap((marker, index) => (marker === END ? [index] : []))
  if (starts.length === 0 && ends.length === 0) {
    const body = text.replace(/(\r?\n)*$/, '')
    return `${body}${eol}${eol}${blockText}${eol}`
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error(
      `${file} has a damaged solidity-ai-kit block (${starts.length} start, ${ends.length} end marker(s)). ` +
        `Fix or remove the ${START} … ${END} lines, then run init again.`
    )
  }
  return [...lines.slice(0, starts[0]), ...block, ...lines.slice(ends[0] + 1)].join(eol)
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
