import path from 'node:path'
import { launchSpec } from '../components.js'
import {
  objectAt,
  parseJsonObject,
  readText,
  setServer,
  stringifyLike,
  withoutServers,
} from './json.js'

// Formats checked against https://code.claude.com/docs/en/mcp and
// https://code.claude.com/docs/en/permissions on 2026-10-23: project servers live in
// `.mcp.json` at the project root (an entry without `type` is stdio), and deny rules use
// the full tool name `mcp__<server>__<tool>` in `.claude/settings.json`.

export const MCP_FILE = '.mcp.json'
export const SETTINGS_FILE = path.join('.claude', 'settings.json')

export function claudeCode(project, { components, notes }) {
  if (components.length === 0) return []
  const edits = []

  const mcpText = readText(project.root, MCP_FILE)
  const mcp = parseJsonObject(MCP_FILE, mcpText)
  const servers = objectAt(MCP_FILE, mcp, 'mcpServers')
  for (const component of components) {
    const spec = launchSpec(component)
    // An entry with a url but no type is a configuration error in Claude Code.
    setServer(
      servers,
      component.id,
      component.transport === 'http' ? { type: 'http', ...spec } : spec
    )
  }
  edits.push({ file: MCP_FILE, after: stringifyLike(mcpText, mcp) })

  // FR-7: every manifest-listed signing or sending tool is denied.
  const rules = components.flatMap(({ id, deniedTools }) =>
    deniedTools.map((tool) => `mcp__${id}__${tool}`)
  )
  if (rules.length > 0) {
    const settingsText = readText(project.root, SETTINGS_FILE)
    const settings = parseJsonObject(SETTINGS_FILE, settingsText)
    const permissions = objectAt(SETTINGS_FILE, settings, 'permissions')
    if (permissions.deny !== undefined && !Array.isArray(permissions.deny)) {
      throw new Error(`${SETTINGS_FILE}: "permissions.deny" is not a list; fix it first.`)
    }
    const deny = permissions.deny ?? []
    permissions.deny = [...deny, ...rules.filter((rule) => !deny.includes(rule))]
    edits.push({ file: SETTINGS_FILE, after: stringifyLike(settingsText, settings) })
  }

  // Claude Code's MCP docs (checked 2026-10-27): interactive sessions prompt before using
  // .mcp.json servers, `claude -p` loads them without asking, `/mcp` checks server status and
  // `claude mcp list` shows one awaiting approval as pending. The desktop app did not ask in
  // the kit's end-to-end run, so this says "may".
  notes.push(
    'Claude Code may ask you to approve the project servers in .mcp.json before using them ' +
      '(claude -p loads them without asking). Run /mcp (or claude mcp list) to see each ' +
      "server's status."
  )
  return edits
}

export function claudeCodeRemove(project, { components }) {
  const edits = []
  const mcpText = readText(project.root, MCP_FILE)
  const mcp = withoutServers(
    MCP_FILE,
    mcpText,
    components.map(({ id }) => id)
  )
  if (mcp !== undefined) edits.push({ file: MCP_FILE, after: mcp })

  const rules = new Set(
    components.flatMap(({ id, deniedTools }) => deniedTools.map((tool) => `mcp__${id}__${tool}`))
  )
  const settingsText = readText(project.root, SETTINGS_FILE)
  if (rules.size === 0 || settingsText === null) return edits
  const settings = parseJsonObject(SETTINGS_FILE, settingsText)
  const deny = settings.permissions?.deny
  if (!Array.isArray(deny) || !deny.some((rule) => rules.has(rule))) return edits
  settings.permissions.deny = deny.filter((rule) => !rules.has(rule))
  if (settings.permissions.deny.length === 0) delete settings.permissions.deny
  if (Object.keys(settings.permissions).length === 0) delete settings.permissions
  edits.push({
    file: SETTINGS_FILE,
    after: Object.keys(settings).length === 0 ? null : stringifyLike(settingsText, settings),
  })
  return edits
}
