// A minimal unified diff for previews (FR-2). The kit only diffs its own small config and
// instruction files, so a quadratic LCS is fast enough and keeps runtime dependencies at
// zero (NFR-9). Above MAX_CELLS the whole file is shown as replaced instead.

const CONTEXT = 3
const MAX_CELLS = 4_000_000

// A last line without a trailing newline is tagged, so "a" and "a\n" never compare equal
// and the "\ No newline" marker can be printed right after it.
const NO_NEWLINE = '\u0000no-newline'

function splitLines(text) {
  if (text === null || text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  else lines[lines.length - 1] += NO_NEWLINE
  return lines
}

// Edit script as [op, line] pairs: ' ' keep, '-' remove, '+' add.
function editScript(a, b) {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((line) => ['-', line]), ...b.map((line) => ['+', line])]
  }
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push([' ', a[i++]])
      j++
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push(['-', a[i++]])
    } else {
      ops.push(['+', b[j++]])
    }
  }
  while (i < a.length) ops.push(['-', a[i++]])
  while (j < b.length) ops.push(['+', b[j++]])
  return ops
}

function range(start, count) {
  if (count === 0) return `${start},0`
  return count === 1 ? `${start + 1}` : `${start + 1},${count}`
}

/**
 * Unified diff of `before` → `after` for `file`. `null` means the file does not exist.
 * Returns '' when the contents are identical.
 */
export function unifiedDiff(file, before, after) {
  if (before === after) return ''
  const ops = editScript(splitLines(before), splitLines(after))
  const changed = ops.map(([op]) => op !== ' ')
  const out = [
    `--- ${before === null ? '/dev/null' : `a/${file}`}`,
    `+++ ${after === null ? '/dev/null' : `b/${file}`}`,
  ]

  let index = 0
  let lineA = 0
  let lineB = 0
  while (index < ops.length) {
    if (!changed[index]) {
      index++
      lineA++
      lineB++
      continue
    }
    // Start CONTEXT lines back, then extend while changes are within 2 * CONTEXT.
    const start = Math.max(0, index - CONTEXT)
    let end = index
    while (end < ops.length) {
      if (changed[end]) {
        end++
        continue
      }
      let next = end
      while (next < ops.length && !changed[next]) next++
      if (next < ops.length && next - end <= 2 * CONTEXT) {
        end = next
      } else {
        end = Math.min(ops.length, end + CONTEXT)
        break
      }
    }

    const back = index - start
    const startA = lineA - back
    const startB = lineB - back
    const body = []
    let countA = 0
    let countB = 0
    for (const [op, line] of ops.slice(start, end)) {
      if (line.endsWith(NO_NEWLINE)) {
        body.push(`${op}${line.slice(0, -NO_NEWLINE.length)}`, '\\ No newline at end of file')
      } else {
        body.push(`${op}${line}`)
      }
      if (op !== '+') countA++
      if (op !== '-') countB++
    }
    out.push(`@@ -${range(startA, countA)} +${range(startB, countB)} @@`, ...body)

    lineA = startA + countA
    lineB = startB + countB
    index = end
  }
  return `${out.join('\n')}\n`
}
