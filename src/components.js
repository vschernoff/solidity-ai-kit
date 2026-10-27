// Which manifest components init installs, and how a client launches each one.

// On by default in this project: enabledByDefault, limited to the project kinds in
// defaultFor when the manifest gives them (kinds as src/detect.js reports them).
export function isDefaultFor(component, project) {
  if (!component.enabledByDefault) return false
  return component.defaultFor === undefined || component.defaultFor.includes(project.kind)
}

// An explicit --with always wins over the project kind.
export function selectComponents(manifest, requested = [], project = { kind: 'none' }) {
  const byId = new Map(manifest.components.map((component) => [component.id, component]))
  const unknown = requested.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    const known = [...byId.keys()].join(', ') || 'none'
    throw new Error(`Unknown component: ${unknown.join(', ')}. In the manifest: ${known}`)
  }
  return manifest.components.filter(
    (component) => isDefaultFor(component, project) || requested.includes(component.id)
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
