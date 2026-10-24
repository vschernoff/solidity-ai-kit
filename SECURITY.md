# Security policy

## Reporting a vulnerability

Report privately through GitHub:
**[open a security advisory](https://github.com/vschernoff/solidity-ai-kit/security/advisories/new)**.

Please do not open a public issue for a vulnerability.

Expect an acknowledgement within three working days and an assessment within ten. If a fix
is warranted it ships as a patch release, with a GitHub Security Advisory and a CVE where one
applies. Reporters are credited unless they ask not to be.

A vulnerability in a component the kit configures (for example `solhint-mcp`) belongs with
that component's own project; report it there. If the kit's pinned version or its risk notes
need to change because of it, tell us too.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

Only the latest published version receives fixes. The package is pre-1.0; there are no
long-term support branches.

## What the kit does, and its attack surface

- **It writes configuration into your project.** `init` and `remove` preview every change and
  write only with `--write`. They write only inside the project directory, refuse to write
  through a symlink that leads outside it, re-check that at write time, and never write
  secrets, keys or credentials. A config file the kit cannot parse is left untouched.
- **It tells your agent's client to start third-party servers.** Each component is pinned to
  an exact version in `kit.manifest.json` and launched as `npx -y <package>@<version>`.
  Components run as separate processes with your privileges. They are chosen by evaluation,
  not at runtime, and their known risks are recorded as risk notes in the manifest.
- **`doctor` starts those servers itself** to check them, in your project directory, and
  stops them afterwards. Starting a component through `npx` fetches it into npm's cache,
  as your client would.
- **No shell, no telemetry, no install scripts.** Processes are spawned with argument arrays;
  the kit has no `postinstall` script and sends nothing anywhere.

## Untrusted repositories

The components run against your project, and some of them run the project's own code: the
Solhint linter loads the project's Solhint plugins and JavaScript config. **Treat the project
directory as trusted input.** Use the kit, and an agent with these tools, only on repositories
you would be willing to run their own tooling in.

## What the kit does not do

It does not send transactions, deploy, or handle private keys, and it does not make a
contract secure. Passing tests and a clean lint are not an audit.
