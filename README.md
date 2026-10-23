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

## How components are chosen

Every component is listed in [`kit.manifest.json`](kit.manifest.json), pinned to an exact
version, with its licence, source and evaluation record. The agent never picks between
competing servers at runtime. A component is enabled by default only once its evaluation
is published in `SCORECARD.md`.

## What it does not do

- It does not send transactions, deploy, or handle private keys.
- It does not make a contract secure. Passing tests and a clean lint are not an audit.
- It does not collect telemetry.

## Licence

MIT. See [LICENSE](LICENSE) and, for the third-party components the kit configures,
[NOTICE](NOTICE).
