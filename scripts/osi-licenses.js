// Regenerates $defs.osiLicense in kit.manifest.schema.json from the SPDX License List
// (D20: a default-enabled component needs an OSI-approved SPDX id). No network access:
// download json/licenses.json from https://github.com/spdx/license-list-data at a release
// tag, then run
//   node scripts/osi-licenses.js <path/to/licenses.json> <tag> && npm run format
// and state the tag and the file's sha256 in the pull request.

import crypto from 'node:crypto'
import fs from 'node:fs'
import { SCHEMA_PATH, readJson } from '../src/manifest.js'

const [source, tag] = process.argv.slice(2)
if (!source || !/^v\d+\.\d+(\.\d+)?$/.test(tag ?? '')) {
  console.error('Usage: node scripts/osi-licenses.js <path/to/licenses.json> <tag, e.g. v3.29.0>')
  process.exit(2)
}

const bytes = fs.readFileSync(source)
const list = JSON.parse(bytes.toString('utf8'))
if (`v${list.licenseListVersion}` !== tag) {
  console.error(`licenses.json is version ${list.licenseListVersion}, not ${tag}`)
  process.exit(1)
}

// Deprecated ids (e.g. GPL-2.0) are left out so manifests use the precise current ones.
const ids = list.licenses
  .filter((license) => license.isOsiApproved && !license.isDeprecatedLicenseId)
  .map((license) => license.licenseId)
  .sort()

const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
const schema = readJson(SCHEMA_PATH)
schema.$defs.osiLicense = {
  $comment:
    `OSI-approved, non-deprecated ids from the SPDX License List ${tag} ` +
    `(github.com/spdx/license-list-data json/licenses.json, sha256 ${sha256}). ` +
    'Regenerate with scripts/osi-licenses.js.',
  enum: ids,
}
fs.writeFileSync(SCHEMA_PATH, `${JSON.stringify(schema, null, 2)}\n`)
console.log(`Wrote ${ids.length} OSI-approved licence ids from SPDX ${tag} (sha256 ${sha256})`)
