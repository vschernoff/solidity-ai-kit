import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { unifiedDiff } from '../src/diff.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-diff-'))
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

// The real check of a diff: git applies it to `before` and gets exactly `after`.
function assertApplies(before, after) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'case-'))
  const file = path.join(dir, 'f.txt')
  if (before !== null) fs.writeFileSync(file, before)
  const patch = path.join(dir, 'change.patch')
  fs.writeFileSync(patch, unifiedDiff('f.txt', before, after))
  // Windows runners set core.autocrlf=true, which would make git write CRLF on apply.
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply', patch], {
    cwd: dir,
    stdio: 'pipe',
  })
  assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, after)
}

describe('unifiedDiff (FR-2 preview)', () => {
  it('is empty for identical contents', () => {
    assert.equal(unifiedDiff('a.json', '{}\n', '{}\n'), '')
  })

  it('shows a new file against /dev/null', () => {
    assert.equal(
      unifiedDiff('.mcp.json', null, '{\n  "mcpServers": {}\n}\n'),
      '--- /dev/null\n+++ b/.mcp.json\n@@ -0,0 +1,3 @@\n+{\n+  "mcpServers": {}\n+}\n'
    )
  })

  it('shows only the changed region with three lines of context', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ''].join('\n')
    const after = before.replace('5\n', 'five\n')
    assert.equal(
      unifiedDiff('n.txt', before, after),
      '--- a/n.txt\n+++ b/n.txt\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n'
    )
  })

  it('flags a missing final newline, so "a" and "a\\n" differ', () => {
    assert.equal(
      unifiedDiff('x', 'a\n', 'a'),
      '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+a\n\\ No newline at end of file\n'
    )
  })

  const cases = {
    create: [null, 'a\nb\n'],
    delete: ['a\nb\n', null],
    'empty to content': ['', 'a\n'],
    prepend: ['b\nc\n', 'a\nb\nc\n'],
    'append without newline': ['a\n', 'a\nb'],
    'add final newline': ['a\nb', 'a\nb\n'],
    'two distant hunks': [
      `${Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n')}\n`,
      `${Array.from({ length: 30 }, (_, i) => (i === 2 || i === 25 ? `L${i}` : `l${i}`)).join('\n')}\n`,
    ],
  }
  for (const [name, [before, after]] of Object.entries(cases)) {
    it(`applies with git: ${name}`, () => assertApplies(before, after))
  }

  it('applies with git for 200 random edits', () => {
    let seed = 1
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const pick = () => ['a', 'b', 'c', '{', '}', ''][random(6)]
    for (let round = 0; round < 200; round++) {
      const before = Array.from({ length: random(12) }, pick)
      const edited = before.flatMap((line) => {
        const roll = random(6)
        if (roll === 0) return []
        if (roll === 1) return [pick(), line]
        if (roll === 2) return [pick()]
        return [line]
      })
      const ending = () => (random(4) === 0 ? '' : '\n')
      const a = before.length ? before.join('\n') + ending() : ''
      const b = edited.length ? edited.join('\n') + ending() : ''
      if (a !== b) assertApplies(a, b)
    }
  })
})
