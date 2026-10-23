import path from 'node:path'
import { launchSpec } from '../components.js'
import { objectAt, parseJsonObject, readText, setServer, stringifyLike } from './json.js'

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

  notes.push(
    'Claude Code asks you to approve project servers from .mcp.json the first time it starts in this project.'
  )
  return edits
}
