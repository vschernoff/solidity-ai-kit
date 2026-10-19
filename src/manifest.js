import fs from 'node:fs'
import path from 'node:path'

export const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..')
export const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'kit.manifest.json')
export const SCHEMA_PATH = path.join(PACKAGE_ROOT, 'kit.manifest.schema.json')

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function loadManifest(file = MANIFEST_PATH) {
  return readJson(file)
}

export function readPackageJson() {
  return readJson(path.join(PACKAGE_ROOT, 'package.json'))
}
