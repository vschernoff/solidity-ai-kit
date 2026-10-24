// NFR-2: pack the kit, install the tarball into a fresh project, and run the installed
// `init` and `doctor` from it, exactly as a user would get them. Run with
// `npm run test:packed`; it needs the network (npm registry) and takes a minute or two.
//
// It checks what only a real install can show: the tarball holds the files the kit needs
// and nothing else, the bin starts, init writes parseable configs pinned to the manifest,
// and doctor starts every manifest component through the real `npx` (on Windows: npm's
// npx-cli.js, never a shell) and completes the MCP handshake.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { PACKAGE_ROOT, loadManifest, readPackageJson } from '../src/manifest.js'
import { resolveNpx } from '../src/mcp-probe.js'

const COMMAND_TIMEOUT_MS = 300_000
const packageJson = readPackageJson()
const manifest = loadManifest()

// npm is a .cmd script on Windows; run its JavaScript entry with node instead of a shell.
function npm(args, cwd) {
  const npx = resolveNpx()
  const command =
    npx.command === 'npx'
      ? { file: 'npm', args }
      : {
          file: process.execPath,
          args: [path.join(path.dirname(npx.prefix[0]), 'npm-cli.js'), ...args],
        }
  return execFileSync(command.file, command.args, {
    cwd,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function hashTree(dir) {
  const hash = crypto.createHash('sha256')
  for (const entry of fs.readdirSync(dir, { recursive: true }).sort()) {
    if (entry.split(path.sep)[0] === 'node_modules') continue
    hash.update(`${entry}\0`)
    const full = path.join(dir, entry)
    if (fs.statSync(full).isFile()) hash.update(fs.readFileSync(full))
  }
  return hash.digest('hex')
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solidity-ai-kit-packed-'))
  const artifacts = path.join(tempRoot, 'artifacts')
  const project = path.join(tempRoot, 'project')
  fs.mkdirSync(artifacts)
  fs.mkdirSync(path.join(project, '.git'), { recursive: true })

  try {
    npm(['pack', '--pack-destination', artifacts], PACKAGE_ROOT)
    const tarball = fs.readdirSync(artifacts).find((file) => file.endsWith('.tgz'))
    assert.ok(tarball, 'npm pack produced no tarball')

    // `tar -tzf` exists on Linux, macOS and Windows 10+ runners.
    const contents = execFileSync('tar', ['-tzf', path.join(artifacts, tarball)], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean)
    const allowed =
      /^package\/(package\.json|README\.md|LICENSE|NOTICE|kit\.manifest(\.schema)?\.json|src\/.+\.js)$/
    const unexpected = contents.filter((file) => !allowed.test(file))
    assert.deepEqual(unexpected, [], 'unexpected files in the tarball')
    for (const required of ['package/NOTICE', 'package/LICENSE', 'package/kit.manifest.json']) {
      assert.ok(contents.includes(required), `${required} missing from the tarball`)
    }
    console.log(`Tarball ${tarball}: ${contents.length} files`)

    fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "smoke", "private": true }\n')
    fs.writeFileSync(path.join(project, 'foundry.toml'), '[profile.default]\n')
    npm(
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(artifacts, tarball)],
      project
    )

    // Run the installed bin as npm would link it, through node (no .cmd shim, no shell).
    const installed = path.join(project, 'node_modules', packageJson.name)
    const installedJson = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'))
    const bin = path.join(installed, installedJson.bin[packageJson.name])
    const kit = (...args) =>
      spawnSync(process.execPath, [bin, ...args], {
        cwd: project,
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
      })

    const version = kit('--version')
    assert.equal(version.status, 0, version.stderr)
    assert.equal(version.stdout.trim(), packageJson.version)

    const withAll = manifest.components.flatMap(({ id }) => ['--with', id])
    const before = hashTree(project)
    const preview = kit('init', ...withAll)
    assert.equal(preview.status, 0, preview.stderr)
    assert.match(preview.stdout, /Preview only; nothing was written/)
    assert.equal(hashTree(project), before, 'init without --write changed the project')

    const written = kit('init', '--write', ...withAll)
    assert.equal(written.status, 0, written.stderr)
    const read = (file) => fs.readFileSync(path.join(project, file), 'utf8')
    const configs = {
      '.mcp.json': JSON.parse(read('.mcp.json')).mcpServers,
      '.cursor/mcp.json': JSON.parse(read(path.join('.cursor', 'mcp.json'))).mcpServers,
      '.codex/config.toml': parseToml(read(path.join('.codex', 'config.toml'))).mcp_servers,
    }
    for (const [file, servers] of Object.entries(configs)) {
      for (const component of manifest.components.filter(({ package: name }) => name)) {
        assert.deepEqual(
          servers[component.id].args.slice(0, 2),
          ['-y', `${component.package}@${component.version}`],
          `${file}: ${component.id}`
        )
      }
    }
    console.log(
      'init: preview left the project unchanged; --write produced parseable, pinned configs'
    )

    // forge is not installed on the runners, so doctor fails on that; the components must
    // still each complete a real handshake through npx.
    const beforeDoctor = hashTree(project)
    // doctor runs the way users run it, through `npx --package=<tarball>`. npm then puts its
    // own run in the environment, which a server started through npx must not inherit (a
    // bug this caught: the nested npx installed the kit instead of the server).
    const npx = resolveNpx()
    const doctor = spawnSync(
      npx.command,
      [
        ...npx.prefix,
        '--yes',
        `--package=${path.join(artifacts, tarball)}`,
        packageJson.name,
        'doctor',
        '--timeout',
        '120',
      ],
      { cwd: project, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }
    )
    console.log(doctor.stdout)
    for (const component of manifest.components) {
      assert.match(
        doctor.stdout,
        new RegExp(`^ {2}healthy {9}${component.id}(?: \\(experimental\\))?: `, 'm'),
        `${component.id} did not complete the handshake:\n${doctor.stdout}\n${doctor.stderr}`
      )
    }
    assert.equal(hashTree(project), beforeDoctor, 'doctor changed the project (FR-13)')
    console.log('Packed installation smoke test passed')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

main()
