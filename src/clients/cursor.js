import path from 'node:path'
import { label, launchSpec } from '../components.js'
import { objectAt, parseJsonObject, readText, setServer, stringifyLike } from './json.js'

// Format checked against https://cursor.com/docs/context/mcp on 2026-10-23: project servers
// live in `.cursor/mcp.json`. Its field table marks `type` required for stdio while its
// examples omit it, so the kit writes it for stdio. Cursor has no per-tool deny in this file, so a
// component with denied tools follows its manifest `denyFallback` (FR-7).

export const MCP_FILE = path.join('.cursor', 'mcp.json')

export function cursor(project, { components, warnings }) {
  const included = []
  for (const component of components) {
    if (component.deniedTools.length === 0) {
      included.push(component)
      continue
    }
    const tools = component.deniedTools.join(', ')
    if (component.denyFallback === 'warn') {
      included.push(component)
      warnings.push(
        `Cursor cannot deny individual tools: ${label(component)} exposes ${tools}. Keep Cursor's tool approval on.`
      )
    } else {
      warnings.push(
        `${label(component)} is not configured for Cursor: Cursor cannot deny its ${tools}.`
      )
    }
  }
  if (included.length === 0) return []

  const text = readText(project.root, MCP_FILE)
  const config = parseJsonObject(MCP_FILE, text)
  const servers = objectAt(MCP_FILE, config, 'mcpServers')
  for (const component of included) {
    const spec = launchSpec(component)
    // Cursor's remote example has no `type`; its stdio table requires one.
    setServer(
      servers,
      component.id,
      component.transport === 'http' ? spec : { type: 'stdio', ...spec }
    )
  }
  return [{ file: MCP_FILE, after: stringifyLike(text, config) }]
}
