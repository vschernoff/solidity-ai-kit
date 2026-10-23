import fs from 'node:fs'
import { resolveInside } from '../changes.js'

// Merging into JSON config files (FR-5): parse what is there, change only the kit's keys,
// and keep everything else, including the file's indentation. Anything that is not a JSON
// object is an error, never overwritten.

// Checks the path before reading, so a config symlinked to a file outside the project is
// never read (its contents could otherwise surface in an error message).
export function readText(root, file) {
  const absolute = resolveInside(root, file)
  try {
    return fs.readFileSync(absolute, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function parseJsonObject(file, text) {
  if (text === null) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    // JSON.parse quotes the input in its message, so it is never shown: the file could
    // hold credentials.
    throw new Error(`${file} is not valid JSON; fix it or move it aside.`, {
      cause: error,
    })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} does not hold a JSON object; fix it or move it aside.`)
  }
  return value
}

export function objectAt(file, parent, key) {
  if (parent[key] === undefined) parent[key] = {}
  const value = parent[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file}: "${key}" is not an object; fix it or move it aside.`)
  }
  return value
}

function indentOf(text) {
  const match = text?.match(/^([ \t]+)\S/m)
  return match ? match[1] : '  '
}

export function stringifyLike(original, value) {
  const eol = original?.includes('\r\n') ? '\r\n' : '\n'
  return `${JSON.stringify(value, null, indentOf(original)).replace(/\n/g, eol)}${eol}`
}

// Fields that decide how a server is launched. The kit owns these on its own entries and
// keeps any other field the user added (for example `env`).
const LAUNCH_FIELDS = ['type', 'command', 'args', 'url']

export function setServer(servers, id, spec) {
  const existing = servers[id]
  const kept =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? Object.fromEntries(Object.entries(existing).filter(([key]) => !LAUNCH_FIELDS.includes(key)))
      : {}
  servers[id] = { ...spec, ...kept }
}

// FR-9: the file without the kit's servers, `null` when nothing else is left in it (init
// created it), or `undefined` when there is nothing to remove.
export function withoutServers(file, text, ids) {
  if (text === null) return undefined
  const config = parseJsonObject(file, text)
  const servers = config.mcpServers
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return undefined
  const present = ids.filter((id) => Object.hasOwn(servers, id))
  if (present.length === 0) return undefined
  for (const id of present) delete servers[id]
  if (Object.keys(servers).length === 0 && Object.keys(config).length === 1) return null
  return stringifyLike(text, config)
}
