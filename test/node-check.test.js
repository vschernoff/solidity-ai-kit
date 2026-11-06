import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { PACKAGE_ROOT, readPackageJson } from '../src/manifest.js'
import { meetsFloor, nodeFloor, nodeProblem } from '../src/node-check.js'

const engines = readPackageJson().engines.node
const read = (file) => fs.readFileSync(path.join(PACKAGE_ROOT, 'src', file), 'utf8')

describe('the Node version guard', () => {
  it('reads the floor from package.json engines', () => {
    assert.equal(nodeFloor(engines), Number(engines.match(/\d+/)[0]))
  })

  it('refuses older Node lines with one line naming the need and the version found', () => {
    for (const version of ['v18.20.8', 'v20.20.2', 'v21.7.3']) {
      assert.equal(meetsFloor(version, '>=22'), false, version)
      assert.equal(
        nodeProblem(version, '>=22'),
        `solidity-ai-kit needs Node >=22 (found ${version}). Install Node 22 or 24: https://nodejs.org/en/download`
      )
    }
  })

  it('accepts the supported lines and newer ones', () => {
    for (const version of ['v22.0.0', 'v22.11.0', 'v24.1.0', 'v26.0.0']) {
      assert.equal(nodeProblem(version, '>=22'), null, version)
    }
    assert.equal(nodeProblem(process.version, engines), null, 'the Node running these tests')
  })

  // On old Node, cli.js crashes while its imports load, before any check could run; so the
  // check has to come first and must not itself need a newer Node.
  it('runs before cli.js is loaded, in files that parse on old Node', () => {
    const bin = read('bin.js')
    assert.doesNotMatch(bin, /^import .*['"]\.\/cli\.js['"]/m, 'no static import of cli.js')
    assert.match(bin, /await import\('\.\/cli\.js'\)/)
    for (const file of ['bin.js', 'node-check.js']) {
      assert.doesNotMatch(read(file), /import\.meta\.(dirname|filename)/, file)
    }
  })
})
