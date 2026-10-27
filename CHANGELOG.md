# Changelog

All notable changes to this project are recorded here. Versions follow semantic
versioning; until 1.0, a minor version may change behaviour.

## Unreleased

### Commands

- In a Hardhat-only project, `init` prints two suggestions and changes nothing for them:
  forge-test-mcp was not set up because it needs Foundry, with the hardhat-foundry plugin's
  `npx hardhat init-foundry` (documented for Hardhat 2); and, when the installed Hardhat
  ships agent skills (3.6.0 and later), a POSIX shell command that copies them (`hardhat`
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
