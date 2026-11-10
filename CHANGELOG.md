# Changelog

All notable changes to this project are recorded here. Versions follow semantic
versioning; until 1.0, a minor version may change behaviour.

## 0.1.5 — 2026-11-10

### Commands

- On Node older than 22, every command now prints one line, "solidity-ai-kit needs Node >=22
  (found vX). Install Node 22 or 24: https://nodejs.org/en/download", and exits 1. Before, Node
  18 crashed with a raw `TypeError` and Node 20 let `init` write files that only `doctor` then
  called unsupported.

### Components

- `solhint-mcp` 0.1.9 (was 0.1.8), a dependency-only update. solhint-mcp's own direct glob
  dependency moves to 14.0.4. Solhint 6.2.5, which it bundles, still brings glob 13.0.7 and
  minimatch 10.2.6, which are in the ranges of advisories (GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249) but not reachable through solhint-mcp, until Solhint updates; dependency
  scanners will keep reporting them. See SCORECARD.md §2.4f.

### Documentation

- The README says that forge-test-mcp and solhint-mcp run the project's own tools and config, so
  `forge test` and `npx solhint` reproduce their results without the kit, and where the two can
  differ.

## 0.1.4 — 2026-11-04

### Commands

- `doctor` checks the installed `forge` against the range forge-test-mcp supports
  (`>=1.8.5 <1.9.0`) when forge-test-mcp is configured. Below the range it reports a problem and
  exits 1, with forge-test-mcp's own hint (`foundryup -i 1.8.6`); above it, a warning, since
  forge-test-mcp still runs but marks the results as untested. It installs nothing. Before, a
  forge older than the range passed every check while forge-test-mcp's tools refused to run.
- The manifest gives a component's supported binary versions in a new `binaryVersions` field.

## 0.1.3 — 2026-11-02

### Components

- `solhint-mcp` 0.1.8 (was 0.1.7). It adds MCP tool annotations to its tools; it still
  bundles Solhint 6.2.5.

### Documentation

- The npm description now starts with what the kit helps with: getting a contract ready for
  an audit (build, test, lint).

## 0.1.2 — 2026-10-29

### Commands

- In a Hardhat-only project, `init` prints two suggestions and changes nothing for them:
  forge-test-mcp was not set up because it needs Foundry, with the hardhat-foundry plugin's
  `npx hardhat init-foundry` (documented for Hardhat 2); and, when the installed Hardhat
  ships agent skills (3.6.0 and later), a `node -e` command that copies them (`hardhat`
  plus the project's toolbox skill) into `.claude/skills` for Claude Code or
  `.agents/skills` for Codex and Cursor.

### Documentation

- The README's Claude Code row says what the one end-to-end run covered (Claude desktop app,
  0.1.0 release candidate, a Foundry and a Foundry + Hardhat project) and what it did not.
- The npm description and the README's first paragraph now start with the task the kit sets
  the agent up for (write Solidity, run the tests and Solhint, fix what fails, report what's
  left), then how. The warnings follow directly: tests and lint are not a security review,
  the servers run the project's code, and a degraded Solhint run is a banner.

## 0.1.1 — 2026-10-27

### Components

- `forge-test-mcp` 0.1.0 (build and test), on by default in Foundry projects, including
  ones that also use Hardhat; not set up in Hardhat-only projects unless asked for with
  `--with forge-test`. It needs `forge` on PATH. Running tests runs the project's code; see
  its risk notes in `kit.manifest.json`.
- The manifest can limit a default component to some kinds of project (`defaultFor`).
  `init` and `doctor` choose defaults the same way; `--with` still adds a component anywhere.

### Commands

- The workflow rules tell the agent to build and test through forge-test-mcp's `build` and
  `run_tests` tools when it is installed, with `forge` in a shell only as a fallback, and
  that a tool error means the tests did not run, whatever the counts say.
- `doctor` checks each binary once (it listed `forge` twice when a component needed it).
- `init`'s note for Claude Code no longer promises an approval prompt for the servers in
  `.mcp.json`: it says Claude Code may ask, and to run `/mcp` (or `claude mcp list`) to see
  each server's status.

## 0.1.0 — preview (2026-10-27)

First public version.

### Commands

- `init` detects a Foundry or Hardhat project, previews every change as a diff and writes
  only with `--write`. It configures the selected components for Codex
  (`.codex/config.toml`), Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`, plus
  `.claude/settings.json` deny rules), merging into existing files, and writes a
  workflow-rules block into `AGENTS.md` and `CLAUDE.md`. `--client` and `--with` choose clients and opt-in
  components.
- `doctor` checks Node, `forge`, `anvil` and `cast`, starts each configured component and
  completes a real MCP handshake, reports missing, wrong version, failed to start and
  healthy separately, and measures each server's `instructions` length from two
  directories. It changes nothing.
- `remove` undoes `init`, with the same preview-then-`--write` behaviour.

### Components

- `solhint-mcp` 0.1.7 (lint), on by default. Linting runs the project's own Solhint plugins
  and JavaScript config; a degraded run is reported as a text banner, not an error. See its
  risk notes in `kit.manifest.json`.

### Safety

- Writes stay inside the project, refuse symlinks that lead outside it, and never include
  secrets. No shell, no telemetry, no install scripts. See `SECURITY.md`.
