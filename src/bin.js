#!/usr/bin/env node
import fs from 'node:fs'
import { nodeProblem } from './node-check.js'

// Check Node before cli.js is loaded: its imports find files relative to their own directory
// in a way that needs Node 20.11 or later, and would crash on older lines before any check
// could run. A static import would be evaluated first, so cli.js is imported after the check.
const { engines } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const problem = nodeProblem(process.version, engines.node)
if (problem) {
  process.stderr.write(`${problem}\n`)
  process.exitCode = 1
} else {
  const { main } = await import('./cli.js')
  process.exitCode = await main(process.argv.slice(2))
}
