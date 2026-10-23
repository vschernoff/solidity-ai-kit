import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { applyChanges, planChanges, renderChanges, resolveInside } from '../src/changes.js'

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-changes-')))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

let counter = 0
function project(files = {}) {
  const dir = path.join(tempRoot, `p${counter++}`)
  fs.mkdirSync(dir)
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8')

// Symlinks need elevated rights on Windows runners.
const symlinkTest = process.platform === 'win32' ? it.skip : it

describe('resolveInside (NFR-4)', () => {
  it('accepts paths inside the project, including names starting with ..', () => {
    const dir = project()
    assert.equal(resolveInside(dir, '.mcp.json'), path.join(dir, '.mcp.json'))
    assert.equal(resolveInside(dir, '..notes'), path.join(dir, '..notes'))
    assert.equal(resolveInside(dir, 'a/../b.json'), path.join(dir, 'b.json'))
  })

  it('refuses paths outside the project and the root itself', () => {
    const dir = project()
    for (const file of ['../x.json', '../../x', path.join(tempRoot, 'x'), '.', '']) {
      assert.throws(() => resolveInside(dir, file), /outside the project/, file)
    }
  })

  symlinkTest('refuses a symlinked directory that points outside', () => {
    const dir = project()
    const outside = project()
    fs.symlinkSync(outside, path.join(dir, '.cursor'), 'dir')
    assert.throws(() => resolveInside(dir, '.cursor/mcp.json'), /via a symlink/)
  })

  symlinkTest('refuses to write through a symlinked file, even a dangling one', () => {
    const dir = project()
    fs.symlinkSync(path.join(tempRoot, 'nowhere.json'), path.join(dir, '.mcp.json'))
    assert.throws(() => resolveInside(dir, '.mcp.json'), /through a symlink/)
  })
})

describe('planChanges / applyChanges (FR-2)', () => {
  it('drops edits that change nothing', () => {
    const dir = project({ 'same.txt': 'x\n' })
    assert.deepEqual(planChanges(dir, [{ file: 'same.txt', after: 'x\n' }]), [])
  })

  it('creates, modifies and deletes on apply, with posix paths in the preview', () => {
    const dir = project({ 'keep.txt': 'old\n', 'gone.txt': 'bye\n' })
    const changes = planChanges(dir, [
      { file: path.join('nested', 'new.txt'), after: 'hello\n' },
      { file: 'keep.txt', after: 'new\n' },
      { file: 'gone.txt', after: null },
    ])
    assert.deepEqual(
      changes.map(({ file }) => file),
      ['nested/new.txt', 'keep.txt', 'gone.txt']
    )
    assert.match(renderChanges(changes), /^\+\+\+ b\/nested\/new\.txt$/m)

    applyChanges(changes)
    assert.equal(read(dir, 'nested/new.txt'), 'hello\n')
    assert.equal(read(dir, 'keep.txt'), 'new\n')
    assert.equal(fs.existsSync(path.join(dir, 'gone.txt')), false)
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
      []
    )
  })

  it('writes nothing if any file changed after the preview', () => {
    const dir = project({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
    const changes = planChanges(dir, [
      { file: 'a.txt', after: 'A\n' },
      { file: 'b.txt', after: 'B\n' },
    ])
    fs.writeFileSync(path.join(dir, 'b.txt'), 'edited by the user\n')
    assert.throws(() => applyChanges(changes), /b\.txt changed since the preview/)
    assert.equal(read(dir, 'a.txt'), 'a\n')
    assert.equal(read(dir, 'b.txt'), 'edited by the user\n')
  })
})
