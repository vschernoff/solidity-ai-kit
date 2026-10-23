import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { PACKAGE_ROOT, readPackageJson } from '../src/manifest.js'

const packageJson = readPackageJson()
const bin = path.join(PACKAGE_ROOT, packageJson.bin[packageJson.name])

// Runs the real bin in a child process, the way npx would, and never rejects: the exit
// code is part of what is under test.
async function cli(...args) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [bin, ...args])
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

describe('cli', () => {
  it('prints the package.json version', async () => {
    const result = await cli('--version')
    assert.equal(result.code, 0)
    assert.equal(result.stdout.trim(), packageJson.version)
  })

  it('prints usage with every command when run without arguments', async () => {
    const result = await cli()
    assert.equal(result.code, 0)
    for (const command of ['init', 'doctor', 'list', 'remove']) {
      assert.match(result.stdout, new RegExp(`^  ${command} `, 'm'))
    }
  })

  it('rejects unknown commands and options with exit code 2', async () => {
    for (const args of [['frobnicate'], ['--frobnicate']]) {
      const result = await cli(...args)
      assert.equal(result.code, 2, args.join(' '))
      assert.match(result.stderr, /Usage: solidity-ai-kit/)
    }
  })

  it('fails loudly for commands that are not implemented yet', async () => {
    const result = await cli('doctor')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /not implemented yet/)
    assert.equal(result.stdout, '')
  })
})
