# solidity-ai-kit — agent instructions

Public, safe to commit. Internal planning lives outside this repo.

## What this repo is

One command that installs a curated, pinned, evaluated set of MCP servers for Solidity
development with AI coding agents, plus the workflow rules that tell the agent how to use
them together. Works with any MCP client. Never Claude-first in copy.

## Hard rules

- **No keys, signing, transactions or deploys** in any code path. No tool that broadcasts.
- **No runtime provider selection.** Components come only from `kit.manifest.json`, pinned
  to exact versions. Changing a component needs evaluation evidence in `SCORECARD.md`.
- **No partner or sponsor promotion. No telemetry.**
- **Never report a clean result when a tool did not run.** Missing binaries, crashes,
  timeouts and unparseable output are errors.
- **No safety claims.** Tests and lint do not prove a contract secure; never imply it.
- **Preview by default.** Commands that change files print the diff and write only with
  `--write`. Merge into existing configs, never clobber. Write only inside the project
  unless `--global` is passed.
- **No shell interpolation.** Use `spawn`/`execFile` with argument arrays.
- **stdout is the MCP protocol channel** on stdio servers. Redirect anything that prints.
- **`instructions` ≤ 512 chars, static text**, checked by a test that performs a real
  `initialize` handshake.
- **Vendor formats are verified, not recalled.** Cite the current vendor doc in the PR.

## Workflow

- Branch + PR for every change. Never push to `main`. Never merge or publish — the
  maintainer approves each one.
- PR body: requirement IDs, what changed, exact commands run with output, what was not
  verified.
- Before asking for review: `npm run lint`, `npm test`, the packed smoke test, all green.
- Commit identity: `vschernoff@users.noreply.github.com`. No AI attribution lines in
  commits or PR descriptions.

## Conventions

- Node 22 and 24 (CI also covers macOS, Linux, Windows).
- **ESM** (`"type": "module"`), decided in the scaffold PR: both supported Node lines run
  ESM natively, and the kit is a CLI with no CJS consumer to stay compatible with. Use
  `node:` specifiers for built-ins and `import.meta.dirname` for paths; read JSON with
  `fs.readFileSync` + `JSON.parse` rather than import attributes.
- Tests use the built-in `node:test` runner (`npm test`); no test framework dependency.
- Runtime dependencies: `smol-toml` only (parses `.codex/config.toml`; it has no dependencies
  of its own and reports passing the official `toml-test` suite). Every new one is justified in
  its PR (NFR-9).
- ESLint flat config + Prettier: single quotes, 2-space indent, ~100-char lines, no empty
  `catch` without a comment, no nested ternaries.
- Tests derive tool names, counts and versions from the source of truth (`package.json`,
  `kit.manifest.json`), never hard-code them.
- MIT licence; `NOTICE` lists every referenced third-party component with its licence.
