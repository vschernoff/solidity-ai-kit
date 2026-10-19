import { parseArgs } from 'node:util'
import { readPackageJson } from './manifest.js'

const COMMANDS = {
  init: 'Preview (or with --write, apply) MCP configs and workflow rules for this project',
  doctor: 'Check the toolchain and that each enabled component starts',
  list: 'List the components in the manifest',
  remove: 'Preview (or with --write, apply) removal of what init wrote',
}

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length))
  const lines = Object.entries(COMMANDS).map(
    ([name, summary]) => `  ${name.padEnd(width)}  ${summary}`
  )
  return [
    'Usage: solidity-ai-kit <command> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    'Options:',
    '  -h, --help     Show this help',
    '  -v, --version  Show the version',
  ].join('\n')
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    })
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage()}\n`)
    return 2
  }

  const { values, positionals } = parsed
  if (values.version) {
    stdout.write(`${readPackageJson().version}\n`)
    return 0
  }
  const [command] = positionals
  if (values.help || command === undefined) {
    stdout.write(`${usage()}\n`)
    return 0
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    stderr.write(`Unknown command: ${command}\n\n${usage()}\n`)
    return 2
  }
  // Commands land in their own pull requests. Until then, say so plainly and fail, so
  // nothing can mistake a no-op for a successful run.
  stderr.write(`solidity-ai-kit ${command}: not implemented yet\n`)
  return 1
}
