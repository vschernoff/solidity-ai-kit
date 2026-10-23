// Which manifest components init installs, and how a client launches each one.

export function selectComponents(manifest, requested = []) {
  const byId = new Map(manifest.components.map((component) => [component.id, component]))
  const unknown = requested.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    const known = [...byId.keys()].join(', ') || 'none'
    throw new Error(`Unknown component: ${unknown.join(', ')}. In the manifest: ${known}`)
  }
  return manifest.components.filter(
    (component) => component.enabledByDefault || requested.includes(component.id)
  )
}

// FR-4: npm components always run at their exact manifest version.
export function launchSpec(component) {
  if (component.transport === 'http') return { url: component.url }
  const extra = component.args ?? []
  if (component.package !== undefined) {
    return { command: 'npx', args: ['-y', `${component.package}@${component.version}`, ...extra] }
  }
  return { command: component.command, args: extra }
}

export function label(component) {
  return component.experimental ? `${component.id} (experimental)` : component.id
}
