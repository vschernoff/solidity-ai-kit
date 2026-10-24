# solidity-ai-kit

> **Pre-release. Nothing here works yet.** The commands below are being built in the open;
> until a version is published on npm, commands that are not built yet say so and exit with
> an error.

One command to set up a curated, pinned set of Solidity MCP servers, plus the workflow rules
that tell your AI coding agent how to use them together. It is meant to work with any MCP
client; each client counts as supported only once that has been verified, and how.

```sh
npx solidity-ai-kit init           # preview what would be written
npx solidity-ai-kit init --write   # write it
npx solidity-ai-kit doctor         # check the toolchain and that each server starts
```

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
version, with its licence, source and evaluation record. The agent never picks between
competing servers at runtime. A component is enabled by default only once its evaluation
is published in `SCORECARD.md`.

<!-- components:start (generated from kit.manifest.json by npm run readme) -->
<!-- prettier-ignore-start -->
| Id | Stage | Runs as | Licence | Default | Evaluation | Open risk notes | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `solhint` | lint | `npx -y solhint-mcp@0.1.5` | MIT | opt-in | not yet evaluated | 2 | [source](https://github.com/vschernoff/solhint-mcp) |
<!-- prettier-ignore-end -->

Risk notes, including what a component cannot protect against, are in `kit.manifest.json`.
<!-- components:end -->

## What it does not do

- It does not send transactions, deploy, or handle private keys.
- It does not make a contract secure. Passing tests and a clean lint are not an audit.
- It does not collect telemetry.

## Licence

MIT. See [LICENSE](LICENSE) and, for the third-party components the kit configures,
[NOTICE](NOTICE).
