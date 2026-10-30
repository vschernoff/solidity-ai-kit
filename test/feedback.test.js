import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { main } from '../src/cli.js'
import { PACKAGE_ROOT, loadManifest } from '../src/manifest.js'
import { rulesBlock } from '../src/rules.js'

// The feedback path is for people: issue forms and a README section. Nothing an agent reads
// as an instruction (the generated rules, CLI output) asks for or mentions reports.

const formsDir = path.join(PACKAGE_ROOT, '.github', 'ISSUE_TEMPLATE')
const readForm = (file) => parseYaml(fs.readFileSync(path.join(formsDir, file), 'utf8'))
const FORMS = ['bug.yml', 'improvement.yml']

// GitHub's form schema (docs checked 2026-10-30): top-level keys, element types, and ids of
// letters, digits, - and _ that are unique in the form.
const TOP_LEVEL = new Set([
  'name',
  'description',
  'title',
  'labels',
  'assignees',
  'projects',
  'type',
  'body',
])
const ELEMENT_TYPES = new Set(['checkboxes', 'dropdown', 'input', 'markdown', 'textarea', 'upload'])

describe('issue forms', () => {
  for (const file of FORMS) {
    describe(file, () => {
      const form = readForm(file)

      it('uses only the keys and element types GitHub accepts', () => {
        for (const key of Object.keys(form)) assert.ok(TOP_LEVEL.has(key), key)
        for (const key of ['name', 'description', 'body']) assert.ok(form[key], key)
        for (const element of form.body) assert.ok(ELEMENT_TYPES.has(element.type), element.type)
      })

      it('gives every field a unique plain-word id an agent can fill', () => {
        const ids = form.body.filter(({ type }) => type !== 'markdown').map(({ id }) => id)
        for (const id of ids) assert.match(id ?? '', /^[a-z][a-z_]*$/, String(id))
        assert.equal(new Set(ids).size, ids.length)
      })

      it('starts with a warning about secrets and asks who wrote the report', () => {
        assert.equal(form.body[0].type, 'markdown')
        assert.match(form.body[0].attributes.value, /private keys, mnemonics, `\.env` contents/)
        const drafted = form.body.find(({ id }) => id === 'drafted_by')
        assert.equal(drafted.type, 'dropdown')
        assert.equal(drafted.validations.required, true)
        assert.deepEqual(drafted.attributes.options, [
          'I wrote it',
          'An AI agent drafted it at my request, and I reviewed it before posting',
        ])
      })

      it('is labelled for triage', () => {
        assert.ok(form.labels.includes('needs-triage'))
      })
    })
  }

  it('keeps blank issues on and sends security problems to a private advisory', () => {
    const config = readForm('config.yml')
    assert.equal(config.blank_issues_enabled, true)
    const security = config.contact_links.find(({ name }) => name === 'Security problem')
    assert.equal(
      security.url,
      'https://github.com/vschernoff/solidity-ai-kit/security/advisories/new'
    )
  })
})

describe('the README feedback section', () => {
  const readme = fs.readFileSync(path.join(PACKAGE_ROOT, 'README.md'), 'utf8')

  it('links the issue chooser and SECURITY.md, before the Security section', () => {
    const section = readme.indexOf('## Report a problem or suggest an improvement')
    assert.ok(section > 0 && section < readme.indexOf('## Security'))
    assert.ok(readme.includes('(https://github.com/vschernoff/solidity-ai-kit/issues/new/choose)'))
    assert.match(
      readme,
      /nothing is sent unless you send it\. This project collects no telemetry\./
    )
  })
})

describe('no feedback text where an agent reads instructions (Directory Policy 2.D)', () => {
  const feedback =
    /\/issues\b|report (a )?problems?|suggest (an )?improvements?|open an issue|feedback/i
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-policy-'))
  after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  it('keeps it out of the workflow rules for every kind of project', () => {
    const { components } = loadManifest()
    for (const kind of ['foundry', 'hardhat', 'both', 'none']) {
      assert.doesNotMatch(rulesBlock({ kind }, components).join('\n'), feedback, kind)
    }
  })

  it('keeps it out of the CLI help and init output', () => {
    let out = ''
    const write = { write: (text) => (out += text) }
    main(['--help'], { stdout: write, stderr: write })
    for (const marker of ['foundry.toml', 'hardhat.config.ts']) {
      const dir = fs.mkdtempSync(path.join(tempRoot, 'p'))
      fs.mkdirSync(path.join(dir, '.git'))
      fs.writeFileSync(path.join(dir, marker), '')
      main(['init'], { cwd: dir, stdout: write, stderr: write })
    }
    assert.match(out, /Usage: solidity-ai-kit/)
    assert.doesNotMatch(out, feedback)
  })
})
