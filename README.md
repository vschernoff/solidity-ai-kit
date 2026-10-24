# solidity-ai-kit

Set up a curated, pinned set of Solidity MCP servers for your AI coding agent, plus the
workflow rules that tell the agent how to use them together, in one command, for every
client you use.

## Status: pre-release, not published

- **Not on npm yet.** `npx solidity-ai-kit` does not work yet. To try it, clone this
  repository, run `npm ci`, and call `node <path-to-clone>/src/bin.js` from your Solidity
  project.
- **One component so far:** [`solhint-mcp`](https://github.com/vschernoff/solhint-mcp), the
  Solhint linter. It is opt-in until its evaluation is recorded, so pass `--with solhint`.
- **Interfaces may still change** before the first release.

```sh
node <path-to-clone>/src/bin.js init --with solhint           # preview what would change
node <path-to-clone>/src/bin.js init --with solhint --write   # write it
node <path-to-clone>/src/bin.js doctor                        # check the toolchain and each server
node <path-to-clone>/src/bin.js remove --write                # undo init
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

| Client               | What `init` writes                                             | How it was checked                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code          | `.mcp.json`, `.claude/settings.json` (deny rules), `CLAUDE.md` | Formats checked against Claude Code's documentation (Oct 2026). Not yet run end-to-end with the kit. Claude Code asks you to approve project servers on first use. |
| Cursor               | `.cursor/mcp.json`, `AGENTS.md`                                | Formats checked against Cursor's documentation (Oct 2026). Not yet run end-to-end. Cursor has no per-tool deny list.                                               |
| Codex                | `.codex/config.toml`, `AGENTS.md`                              | Formats checked against OpenAI's Codex documentation (Oct 2026). Not yet run end-to-end. Codex reads the project file only for projects you trust.                 |
| Any other MCP client | nothing yet                                                    | Use each component's own README.                                                                                                                                   |

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

<!-- components:start (generated from kit.manifest.json by npm run readme) -->
<!-- prettier-ignore-start -->
| Id | Stage | Runs as | Licence | Default | Evaluation | Open risk notes | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `solhint` | lint | `npx -y solhint-mcp@0.1.4` | MIT | opt-in | not yet evaluated | 3 | [source](https://github.com/vschernoff/solhint-mcp) |
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

## Licence

MIT. See [LICENSE](LICENSE) and, for the third-party components the kit configures,
[NOTICE](NOTICE).
