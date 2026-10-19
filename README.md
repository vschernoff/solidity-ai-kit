# solidity-ai-kit

> **Pre-release. Nothing here works yet.** The commands below are being built in the open;
> until a version is published on npm, `solidity-ai-kit` only prints its usage.

One command to set up a curated, pinned set of Solidity MCP servers, plus the workflow rules
that tell your AI coding agent how to use them together. It works with any MCP client.

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
