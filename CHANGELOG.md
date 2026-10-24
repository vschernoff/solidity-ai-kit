# Changelog

All notable changes to this project are recorded here. Versions follow semantic
versioning; until 1.0, a minor version may change behaviour.

## 0.1.0 — preview (unreleased)

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
