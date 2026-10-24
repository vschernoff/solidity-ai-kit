import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { parse, stringify } from 'smol-toml'
import { launchSpec } from '../components.js'
import { readText } from './json.js'

// Format checked against https://learn.chatgpt.com/docs/extend/mcp?surface=cli and
// https://learn.chatgpt.com/docs/config-file/config-basic on 2026-10-23: MCP servers can be
// scoped to a project in `.codex/config.toml` ("trusted projects only"), one
// `[mcp_servers.<name>]` table each with `command`, `args` (or `url`), and `disabled_tools`
// as the per-tool deny list (FR-7).
//
// The user's file is never re-serialized, so its comments and layout survive. Only the
// kit's own `[mcp_servers.<id>]` tables (and their sub-tables) are rewritten in place, and
// the result is parsed and compared with exactly what was intended. Any difference, for
// example an entry written as an inline table or with dotted keys, stops init instead of
// guessing.

export const CONFIG_FILE = path.join('.codex', 'config.toml')

const LAUNCH_FIELDS = ['command', 'args', 'url']

function isTable(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseToml(text) {
  if (text === null) return {}
  try {
    return parse(text)
  } catch (error) {
    // Only the position: smol-toml's message quotes the source, which could hold secrets.
    const where = Number.isInteger(error.line)
      ? ` (line ${error.line}, column ${error.column})`
      : ''
    throw new Error(`${CONFIG_FILE} is not valid TOML${where}; fix it or move it aside.`, {
      cause: error,
    })
  }
}

function entryFor(component, existing) {
  const kept = isTable(existing)
    ? Object.fromEntries(Object.entries(existing).filter(([key]) => !LAUNCH_FIELDS.includes(key)))
    : {}
  const entry = { ...launchSpec(component), ...kept }
  const denied = [...(Array.isArray(kept.disabled_tools) ? kept.disabled_tools : [])]
  for (const tool of component.deniedTools) if (!denied.includes(tool)) denied.push(tool)
  if (denied.length > 0) entry.disabled_tools = denied
  return entry
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

// Header lines of the table for `id` and its sub-tables, bare or quoted.
function ownHeader(id) {
  const key = escapeRegExp(id)
  return new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${key}|"${key}"|'${key}')\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`
  )
}

const ANY_HEADER = /^\s*\[/

// Replaces the kit's tables for `id` with `block`, at the position of the first one, or
// appends `block` when there is none.
function replaceTables(lines, id, block) {
  const own = ownHeader(id)
  const out = []
  let inserted = false
  let skipping = false
  // Comments directly above the next table describe that table, so they are kept with it.
  let comments = []
  for (const line of lines) {
    if (own.test(line)) {
      skipping = true
      comments = []
      if (!inserted) {
        out.push(...block)
        inserted = true
      }
      continue
    }
    if (skipping && ANY_HEADER.test(line)) {
      skipping = false
      out.push(...comments)
    }
    if (skipping) {
      if (/^\s*#/.test(line)) comments.push(line)
      else if (line.trim() !== '') comments = []
      continue
    }
    out.push(line)
  }
  if (!inserted) {
    while (out.length > 0 && out.at(-1).trim() === '') out.pop()
    if (out.length > 0) out.push('')
    out.push(...block)
  }
  return out
}

// smol-toml returns null-prototype objects and date classes; compare plain, key-sorted data.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (
    value instanceof Date ||
    (value !== null && typeof value === 'object' && 'toISOString' in value)
  ) {
    return String(value)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key])])
    )
  }
  return value
}

function snippet(entries) {
  return stringify({ mcp_servers: entries }).trimEnd()
}

export function codex(project, { components, notes }) {
  if (components.length === 0) return []

  const before = readText(project.root, CONFIG_FILE)
  const current = parseToml(before)
  if (current.mcp_servers !== undefined && !isTable(current.mcp_servers)) {
    throw new Error(`${CONFIG_FILE}: "mcp_servers" is not a table; fix it first.`)
  }

  const entries = {}
  for (const component of components) {
    entries[component.id] = entryFor(component, current.mcp_servers?.[component.id])
  }
  const expected = { ...current, mcp_servers: { ...current.mcp_servers, ...entries } }

  const eol = before?.includes('\r\n') ? '\r\n' : '\n'
  let lines = before === null ? [] : before.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  for (const [id, entry] of Object.entries(entries)) {
    // Each block ends with a blank line so the next table stays visually separate.
    const block = stringify({ mcp_servers: { [id]: entry } }).split('\n')
    lines = replaceTables(lines, id, block)
  }
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop()
  const after = `${lines.join(eol)}${eol}`

  let result
  try {
    result = parse(after)
  } catch {
    result = undefined
  }
  if (result === undefined || !isDeepStrictEqual(normalize(result), normalize(expected))) {
    throw new Error(
      `${CONFIG_FILE} defines these servers in a way the kit cannot edit safely ` +
        `(for example an inline table, dotted keys, or a multi-line value next to them). ` +
        `Nothing was written. Replace those entries with:\n\n` +
        `${snippet(entries)}\n`
    )
  }

  notes.push(
    `Codex reads ${CONFIG_FILE.split(path.sep).join('/')} only when you trust this project.`
  )
  return [{ file: CONFIG_FILE, after }]
}

// FR-9: drops the kit's tables (and sub-tables) as text, then checks by parsing that the
// result is the original config minus exactly those servers.
export function codexRemove(project, { components }) {
  const before = readText(project.root, CONFIG_FILE)
  if (before === null) return []
  const current = parseToml(before)
  const servers = isTable(current.mcp_servers) ? current.mcp_servers : {}
  const ids = components.map(({ id }) => id).filter((id) => Object.hasOwn(servers, id))
  if (ids.length === 0) return []

  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  let lines = before.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  for (const id of ids) lines = replaceTables(lines, id, [])
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop()
  const after = lines.length === 0 ? null : `${lines.join(eol)}${eol}`

  const rest = Object.fromEntries(Object.entries(servers).filter(([id]) => !ids.includes(id)))
  const expected = { ...current }
  if (Object.keys(rest).length > 0) expected.mcp_servers = rest
  else delete expected.mcp_servers
  let result
  try {
    result = after === null ? {} : parse(after)
  } catch {
    result = undefined
  }
  // An emptied [mcp_servers] parent table may remain; it carries nothing.
  if (result && isTable(result.mcp_servers) && Object.keys(result.mcp_servers).length === 0) {
    delete result.mcp_servers
  }
  if (result === undefined || !isDeepStrictEqual(normalize(result), normalize(expected))) {
    throw new Error(
      `${CONFIG_FILE} defines the kit's servers in a way it cannot remove safely ` +
        `(for example an inline table or dotted keys). Nothing was written. ` +
        `Remove these tables by hand: ${ids.map((id) => `[mcp_servers.${id}]`).join(', ')}`
    )
  }
  return [{ file: CONFIG_FILE, after }]
}
