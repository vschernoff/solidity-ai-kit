// A stand-in stdio MCP server for doctor tests. The first argument picks its behaviour.
import readline from 'node:readline'

const [mode = 'healthy', arg = ''] = process.argv.slice(2)

if (mode === 'crash') process.exit(3)
// Ignores end of input and stays alive until killed.
if (mode === 'stubborn') setInterval(() => {}, 1000)

function reply(result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, ...result })}\n`)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method !== 'initialize') return
  const serverInfo = { name: 'stub', version: mode === 'version' ? arg : '1.0.0' }
  if (mode === 'hang' || mode === 'stubborn') return
  if (mode === 'noise') process.stdout.write('warning: loading plugins\n')
  if (mode === 'error') return reply({ error: { code: -32603, message: 'boom' } })
  const instructions = {
    fixed: 'x'.repeat(Number(arg || 600)),
    path: `Lint the project in ${process.cwd()}.`,
  }[mode]
  reply({ result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo, instructions } })
})
