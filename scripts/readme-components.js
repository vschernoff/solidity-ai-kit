// FR-14: the README's component table is generated from kit.manifest.json, never edited by
// hand. `npm run readme` rewrites it; test/readme.test.js fails when the two drift apart.

import fs from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT, loadManifest } from '../src/manifest.js'

export const README_PATH = path.join(PACKAGE_ROOT, 'README.md')
export const TABLE_START =
  '<!-- components:start (generated from kit.manifest.json by npm run readme) -->'
export const TABLE_END = '<!-- components:end -->'

function launch(component) {
  if (component.package) return `\`npx -y ${component.package}@${component.version}\``
  return `\`${component.command}\` ${component.version}`
}

function status(component) {
  if (component.enabledByDefault) return 'on by default'
  return component.experimental ? 'opt-in, experimental' : 'opt-in'
}

function evaluation(component) {
  return component.evaluatedAt === null ? 'not yet evaluated' : `evaluated ${component.evaluatedAt}`
}

function openRiskNotes(component) {
  return component.riskNotes.filter(({ resolved }) => !resolved).length
}

export function componentTable(manifest) {
  const rows = manifest.components.map((component) =>
    [
      `\`${component.id}\``,
      component.stage,
      launch(component),
      component.license ?? 'none',
      status(component),
      evaluation(component),
      String(openRiskNotes(component)),
      `[source](${component.source})`,
    ].join(' | ')
  )
  // Prettier would realign the table; the ignore markers keep it exactly as generated.
  return [
    TABLE_START,
    '<!-- prettier-ignore-start -->',
    '| Id | Stage | Runs as | Licence | Default | Evaluation | Open risk notes | Source |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '<!-- prettier-ignore-end -->',
    '',
    'Risk notes, including what a component cannot protect against, are in `kit.manifest.json`.',
    TABLE_END,
  ].join('\n')
}

export function withTable(readme, table) {
  const start = readme.indexOf(TABLE_START)
  const end = readme.indexOf(TABLE_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error('README.md has no component table markers')
  }
  return `${readme.slice(0, start)}${table}${readme.slice(end + TABLE_END.length)}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const readme = fs.readFileSync(README_PATH, 'utf8')
  const updated = withTable(readme, componentTable(loadManifest()))
  if (updated === readme) {
    console.log('README component table is up to date.')
  } else {
    fs.writeFileSync(README_PATH, updated)
    console.log('README component table rewritten from kit.manifest.json.')
  }
}
