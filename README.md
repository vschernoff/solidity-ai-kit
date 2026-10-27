# solidity-ai-kit

`solidity-ai-kit` sets up your AI coding agent to write Solidity, run the tests and Solhint,
fix what fails, and report what's left. One command does it for Codex, Cursor and Claude
Code, in Foundry and Hardhat projects: it configures curated, pinned MCP servers (Solhint for
linting and, in Foundry projects, forge-test-mcp for builds and tests) and adds workflow
rules that tell the agent to build, test and lint in order, stop after five rounds, and never
make a check pass by weakening it unless you agree.

**Before you rely on it:** passing tests and a clean lint are not a security review or an
audit. The servers run the project's own code (Solhint plugins and config; in Foundry
projects, Solidity tests and cheatcodes), so use them only on repositories you trust. A
degraded Solhint run is a text banner, not an error, so the agent has to read it. Details are
under Status below.

## Status: preview release (0.1.x)

- **Preview.** `0.1.x` is the first public version. Run it from your Solidity project with
  `npx solidity-ai-kit`; it needs Node 22 or later.
- **Two components so far**, each on by default since its evaluation (October 2026). Know
  this before relying on them:
  - [`solhint-mcp`](https://github.com/vschernoff/solhint-mcp), the Solhint linter, in every
    project.
    - **It runs the project's own code.** Linting, or reading the config with `get_config`,
      loads that repository's Solhint plugins and JavaScript config, the same as running
      `npx solhint` there. Do not use it on a repository you do not trust.
    - **A degraded run is a text banner, not an error.** When a plugin fails to load or a
      rule id is unknown, the result starts with a "⚠️ This run was degraded" banner naming
      each problem, and the findings from the rules that did run still follow. The result
      is not marked as an error, so the agent has to read the banner.
  - [`forge-test-mcp`](https://github.com/vschernoff/forge-test-mcp), Foundry builds and
    tests, in Foundry projects (including ones that also use Hardhat). It needs `forge`.
    - **It runs the project's own code.** Running tests executes the project's Solidity and
      cheatcodes with your privileges, the same as running `forge test` there. Do not use it
      on a repository you do not trust.
    - **FFI is off; the network is not.** FFI stays off unless the server is started with
      `--allow-ffi`, even when `foundry.toml` enables it. Tests can still reach the network
      through fork cheatcodes or RPC endpoints the project configures.
- **Interfaces may still change** before 1.0.

```sh
npx solidity-ai-kit init            # preview what would change
npx solidity-ai-kit init --write    # write it
npx solidity-ai-kit doctor          # check the toolchain and each server
npx solidity-ai-kit remove --write  # undo init
```

## What the commands do

- **`init`** detects a Foundry or Hardhat project and prints every change it would make as
  a diff. It writes only with `--write`. It adds the selected components to each client's
  project config, merging into existing files rather than replacing them, and writes a
  short workflow-rules block into `AGENTS.md` and `CLAUDE.md`. `--client` limits it to
  `claude-code`, `codex` or `cursor`.
- **`doctor`** checks Node, `forge`, `anvil` and `cast`, then starts each configured
  component and completes a real MCP handshake. A server that crashes, hangs or prints
  anything but protocol messages is reported as failed, never as healthy. It also measures
  each server's `instructions` text and warns when it is longer than a configured client
  recommends. It changes nothing.
- **`remove`** undoes `init`: it takes the kit's entries out of the client configs and the
  rules block out of `AGENTS.md` and `CLAUDE.md`, and previews before `--write` like `init`.
- **`list`** is not implemented yet.

## Clients

Each row says how far support has actually been checked.

| Client               | What `init` writes                                             | How it was checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code          | `.mcp.json`, `.claude/settings.json` (deny rules), `CLAUDE.md` | Formats checked against Claude Code's documentation (Oct 2026). Run end-to-end once (2026-10-26, the 0.1.0 release candidate, in the Claude desktop app's Code sessions, on a Foundry and a Foundry + Hardhat project): the agent linted and fixed with the solhint MCP tools, fixed the source rather than the test, and got `forge test` passing; the desktop app did not ask to approve the project server. Not yet run end-to-end with the Claude Code CLI, or with forge-test-mcp (added in 0.1.1) in any client. Claude Code may ask you to approve project servers before using them (`claude -p` loads them without asking); run `/mcp` (or `claude mcp list`) to see each server's status. |
| Cursor               | `.cursor/mcp.json`, `AGENTS.md`                                | Formats checked against Cursor's documentation (Oct 2026). Not yet run end-to-end. Cursor has no per-tool deny list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Codex                | `.codex/config.toml`, `AGENTS.md`                              | Formats checked against OpenAI's Codex documentation (Oct 2026). Not yet run end-to-end. Codex reads the project file only for projects you trust.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Any other MCP client | nothing yet                                                    | Use each component's own README.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Where it fits

Start with the smallest step that does the job:

1. **Just the linter, any MCP client:** run [`solhint-mcp`](https://github.com/vschernoff/solhint-mcp)
   directly. Its README has the config for each client.
2. **Just the linter, in Claude Code:** the
   [`solhint-mcp-plugin`](https://github.com/vschernoff/solhint-mcp-plugin) installs it with a
   linting skill.
3. **The whole workflow:** `solidity-ai-kit` sets up a curated, pinned set of tools for every client
   you use, from one manifest, plus the rules that tell the agent how to use them together.

The kit configures solhint-mcp too, so pick one step per project: using the plugin and
the kit together would configure solhint-mcp twice.

## How components are chosen

Every component is listed in [`kit.manifest.json`](kit.manifest.json), pinned to an exact
version, with its licence, source, evaluation record and risk notes. The agent never picks
between competing servers at runtime. A component is enabled by default only once its
evaluation is recorded, and only with an OSI-approved licence; until then it is opt-in.
A default can be limited to some kinds of project (for example, a Foundry test runner only
where there is a `foundry.toml`); `--with <id>` still adds it anywhere.

<!-- components:start (generated from kit.manifest.json by npm run readme) -->
<!-- prettier-ignore-start -->
| Id | Stage | Runs as | Licence | Default | Evaluation | Open risk notes | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `solhint` | lint | `npx -y solhint-mcp@0.1.7` | MIT | on by default | evaluated 2026-10-24 | 1 | [source](https://github.com/vschernoff/solhint-mcp) |
| `forge-test` | build-test | `npx -y forge-test-mcp@0.1.0` | MIT | on by default in Foundry, Foundry + Hardhat projects | evaluated 2026-10-26 | 3 | [source](https://github.com/vschernoff/forge-test-mcp) |
<!-- prettier-ignore-end -->

Risk notes, including what a component cannot protect against, are in `kit.manifest.json`.
<!-- components:end -->

## What it does not do

- It does not send transactions, deploy, or handle private keys.
- It does not make a contract secure. Passing tests and a clean lint are not an audit.
- It does not make an untrusted repository safe to work in. Linting a project runs that
  project's own Solhint plugins and JavaScript config, exactly as running `solhint` there
  would.
- It does not collect telemetry.

## Known limits

- Merging into a JSON config keeps its content and key order, but rewrites its layout in
  the kit's formatting.
- `remove` has no record of what `init` added. It removes every component id the kit knows
  about, including an entry with the same id written by hand before `init`, and empty
  `.claude/`, `.codex/` or `.cursor/` directories that existed before `init`. A rules file
  comes back with exactly one trailing newline.
- Windows is tested in CI, but no client has been run end-to-end on Windows with the kit.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability and what the kit's attack
surface is.

## Requirement IDs

Requirement IDs in code and tests (FR-, NFR-, D-) refer to the project's internal
specification.

## Licence

MIT. See [LICENSE](LICENSE) and, for the third-party components the kit configures,
[NOTICE](NOTICE).
