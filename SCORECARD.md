# Scorecard

Why each MCP server is, or is not, in `kit.manifest.json`. The kit's value is this curation, so
the criteria and the evidence are public (SRS NFR-7). No component is included, ranked or
enabled for payment or partnership.

|              |                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last updated | 2026-10-26                                                                                                                                                           |
| Evidence     | `eval/` in this repository: fixtures with forge-confirmed ground truth, the handshake probe and the stage cases, all run in CI in a pinned container with no network |
| Decisions    | Proposed by the evaluator, approved by the maintainer                                                                                                                |

**Nothing here says a contract is secure.** A clean lint, passing tests or an empty analyser
report do not prove safety. The kit's tools report what they find, and say when they could not
run.

## 0. How to read this

**Gates.** A candidate is excluded if it fails any of these. They are checked by reading the
source at the exact published version, and by execution where the harness can:

| Gate | Requirement                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1   | A licence. Enabled by default only with an OSI-approved SPDX licence (D20); anything else is opt-in at most                                                                                                                                                        |
| G2   | Public source matching the published artefact                                                                                                                                                                                                                      |
| G3   | No network access beyond the tool's stated purpose                                                                                                                                                                                                                 |
| G4   | No shell interpolation of tool inputs, no file access outside the project                                                                                                                                                                                          |
| G5   | No install-time scripts                                                                                                                                                                                                                                            |
| G6   | No telemetry on by default                                                                                                                                                                                                                                         |
| G7   | No key handling, signing or transaction sending that a client cannot deny per tool                                                                                                                                                                                 |
| G8   | forge writes `out/` and `cache/` in the project. When the project enables FFI, a temporary configuration with FFI off is written under the system temp directory, not in the project, and removed after the run (removal known at source). Nothing written to HOME | At source; HOME by execution (probe) |

Beyond the gates: **C2** `instructions` length, measured live from two working directories; **C3**
nothing but the protocol on stdout; **C4** run health, meaning a tool that did not fully run says
so and never looks clean.

**How each claim is known.** "By execution" means a CI run of `eval/` (the Eval workflow, in the
pinned container with no network). Each result is recorded on this page with its date, the
component version and the outcome, so the page stands on its own; runs from before this repository
was published are recorded, not linked. "At
source" means read in the published code. Anything else is marked _not verified_.

**IDs.** `D20`, `D39` and similar are decisions, and `FR-`/`NFR-` are requirements, in the
project's internal specification (see the README). This page states each one in full where it
uses it.

**Disclosure.** Where a candidate's failing gate is a security issue not yet public upstream,
this page names only the gate. Details are reported privately to the maintainers first.

## 1. Decision per stage

| Stage                           | Component                    | Default                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lint**                        | `solhint-mcp` 0.1.7 (MIT)    | **on**                      | Passes G1–G8. Lint-stage cases 21/21 and a clean probe by execution (§2.4d). Risk notes are in the manifest: linting runs the repository's own Solhint plugins and JS config, so it is not safe for untrusted repositories; and a degraded run is a banner in the result text, not `isError`.                                                                                                                                                                                                                                                      |
| **Build / test**                | `forge-test-mcp` 0.1.0 (MIT) | **on** for Foundry projects | Passes G1–G8. Build/test-stage cases 22/22 by execution on forge 1.8.5 and 1.8.6 (§2.5). Results match the forge-confirmed ground truth. Whenever forge produced no report, the tool returns an error with a code. FFI stays off even when foundry.toml enables it, secret values are redacted, and output stays within its size budget. Risk notes are in the manifest: running tests runs the project's code, so it is not safe for untrusted repositories. Made by the kit's maintainer, and held to the same gates and cases as any candidate. |
| Foundry utilities (anvil, cast) | none                         | —                           | Every candidate fails G1, G2, G4 or G7 (§2.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Static analysis                 | none in v0.1                 | —                           | `trailofbits/slither-mcp` passes every gate except G6, which a flag mitigates. It is out of v0.1 by decision (D39): telemetry is on unless disabled by a flag, and an analyser failure can come back as an empty, successful result (C4) (§2.2).                                                                                                                                                                                                                                                                                                   |
| Fuzzing                         | none                         | —                           | No stable Echidna release includes the MCP server; the preview build is excluded. Re-evaluated on the first stable release that includes it.                                                                                                                                                                                                                                                                                                                                                                                                       |
| On-chain read                   | none                         | —                           | The official Etherscan server is hosted and closed-source (G1, G2). Blockscout's moved to a proprietary licence and sends tool arguments as telemetry by default (G1, G6) (§2.3).                                                                                                                                                                                                                                                                                                                                                                  |

## 2. Evidence

### 2.1 Foundry and build/test candidates

| Candidate                                 | Version read   | Licence             | Decision                                                                                                                                                                                                            |
| ----------------------------------------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PraneshASP/foundry-mcp-server`           | npm 0.1.5      | MIT                 | Excluded: fails **G4** (shell interpolation of tool inputs; public upstream issue `PraneshASP/foundry-mcp-server#14`) and **G7** (a signing tool fed from the environment, not containable by a per-tool deny-list) |
| `maxencerb/foundry-mcp`                   | npm 0.1.3      | MIT                 | Excluded: fails **G4**. Also needs Bun, not Node                                                                                                                                                                    |
| `lhemerly/foundry-mcp`                    | main `6ae4063` | MIT                 | Excluded: fails **G7** (generic command tools can sign or broadcast, so a per-tool deny-list cannot contain them)                                                                                                   |
| `foundry-mcp-server` (npm, no repository) | npm 0.0.1      | none in the package | Excluded: fails **G2** (no source repository) and **G4**                                                                                                                                                            |
| `0xClandestine/foundry-mcp-rs`            | main `48b77ea` | none                | Excluded: fails **G1**                                                                                                                                                                                              |

None of these runs `forge test` and returns structured, honest results, which is why the kit has
its own interpreter for that stage (§2.5).

### 2.2 Static analysis

| Candidate                       | Version read   | Licence           | Decision                                                                                                                                                                                            |
| ------------------------------- | -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trailofbits/slither-mcp`       | tag v2.3.2     | AGPL-3.0-or-later | Not in v0.1 (D39). Telemetry on by default with an opt-out flag (G6, mitigable). Analyser exceptions can yield an empty result reported as success (C4). Not on PyPI, so dependency versions float. |
| `remix-project-org/slither-mcp` | main `fd30292` | none              | Excluded: fails **G1**, **G3** and **G4**                                                                                                                                                           |
| `lhemerly/slither-mcp`          | main `25266b9` | MIT (file only)   | Excluded: failures reported as "no issues" (C4); inactive                                                                                                                                           |

### 2.3 Fuzzing and on-chain read

| Candidate                        | Version read                                          | Licence                                          | Decision                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Echidna MCP server               | Echidna stable 2.3.3 and earlier                      | AGPL-3.0                                         | No stable release includes the MCP server; the preview build is excluded                                                                                          |
| Etherscan MCP (official, hosted) | `etherscan-mcp` 2.4.0, keyless endpoint, checked live | not stated                                       | Excluded: hosted and closed-source (**G1**, **G2**). Read-only: all 16 keyless tools are marked `readOnlyHint` (checked live)                                     |
| `blockscout/mcp-server`          | v0.19.0                                               | `LicenseRef-Blockscout` (proprietary, revocable) | Excluded: **G1** (opt-in at most under D20) and **G6** (tool arguments sent to Blockscout by default; documented opt-out). Hosted instructions are 611 characters |
| `blockscout/mcp-server`          | v0.15.0 (last MIT)                                    | MIT                                              | Excluded: **G6**, the same default                                                                                                                                |

### 2.4 solhint-mcp

#### 2.4a Code loading through an agent-supplied config

In 0.1.3, a `config` argument whose `extends` was an absolute path made Solhint load that file as
code. Fixed in 0.1.4: a tool-supplied config accepts only the built-in `solhint:*` presets and
no `plugins`. `plugins` was never a vector, because Solhint prefixes plugin names, so the require
fails. The project's own `.solhint.json` is deliberately not covered. It carries the same trust as
running `npx solhint` in that repository.

#### 2.4b Instructions (C2)

From 0.1.5 the `instructions` field is a fixed 502-character string. Before that it embedded the
project path and measured 693–816 characters, depending on the path (CI probe and the
maintainer's measurements). By execution in the
probe on 0.1.5, 0.1.6 and 0.1.7 (CI, 2026-10-24): `[502, 502]` from a shallow and a deep working directory, not
variable.

#### 2.4c Run health (C4)

Up to 0.1.5, a plugin that failed to load or a rule id that does not exist made the lint check
less than configured without saying so, and `get_config` reported "✅" over such a config. 0.1.6
added a degraded-run banner. 0.1.7 also catches it when `FORCE_COLOR` is set, which made
Solhint's warnings carry colour codes the 0.1.6 matcher missed. A degraded run is a banner, not
`isError`: that is the maintainer's design, so findings from the rules that did load stay
usable.

#### 2.4d Lint-stage cases, by execution

The cases are in `eval/cases/lint.json`. Each runs one tool call on a fresh copy of a fixture, in
its own server process, inside the pinned container with `--network none --read-only` as a
non-root user. They are requirements on any lint server, not on one implementation.

| Group                                                                                                                                                 | Cases  | 0.1.5 (CI, 2026-10-24)  | 0.1.7 (CI, 2026-10-24) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | ---------------------- |
| F01 clean project                                                                                                                                     | 1      | pass                    | pass                   |
| F10 invalid `.solhint.json` must be an error (`lint_project`, `get_config`)                                                                           | 2      | pass                    | pass                   |
| F14 plugin not installed: must name it, ± `FORCE_COLOR`, `get_config` must not say "✅"                                                               | 4      | **fail** (4)            | pass                   |
| F15 unknown rule id: same                                                                                                                             | 4      | **fail** (4)            | pass                   |
| F16 a plugin that prints chatter: not reported as a problem, nothing on the MCP stdout                                                                | 3      | pass                    | pass                   |
| Agent-supplied config must not load code: `extends` absolute / array / `solhint:../` / relative, `plugins`, `plugins` + `pluginPaths`, `fix_solidity` | 7      | pass                    | pass                   |
| **Total**                                                                                                                                             | **21** | **13 passed, 8 failed** | **21 passed**          |

The F14/F15 cases require the item's name and a failure phrase on the same line, so
`get_config`'s echo of the project config cannot satisfy them. Four of the seven code-loading
cases are regression guards: Solhint itself already refused those forms in 0.1.3.

Probe on 0.1.7 (same run): 7 tools, healthy; 0 non-protocol bytes on stdout; canary keys in the
environment not leaked; nothing written to HOME; install integrity matches the pin; no install
scripts.

### 2.5 forge-test-mcp

`forge-test-mcp` is the kit's own build/test server, made by the kit's maintainer. It is held to
the same gates and cases as any candidate. Version read: npm 0.1.0. All 27 files of the npm
tarball are byte-identical to tag `v0.1.0` of `vschernoff/forge-test-mcp`, the commit the package
names as its `gitHead`.

#### 2.5a Gates

| Gate | Result                                                                                                                                                                    | How known                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| G1   | MIT. Dependencies: `@modelcontextprotocol/server` and `@modelcontextprotocol/core` 2.3.1 (Apache-2.0), `zod` (MIT)                                                        | At source                           |
| G2   | The npm tarball is byte-identical to the tagged source                                                                                                                    | File-by-file comparison             |
| G3   | No network code; every forge call passes `--offline`                                                                                                                      | At source                           |
| G4   | forge starts from an argument array, never a shell; each agent-supplied filter becomes one `--flag=value` argument, so a filter that looks like a flag is matched as text | At source, and by execution (§2.5b) |
| G5   | No install-time scripts in the four-package tree                                                                                                                          | By execution (CI install)           |
| G6   | No telemetry                                                                                                                                                              | At source                           |
| G7   | Three tools, `run_tests`, `explain_failure` and `build`; none signs, sends transactions or accepts keys                                                                   | At source                           |
| G8   | forge writes `out/` and `cache/` in the project; when the project enables FFI, a temporary configuration with FFI off, removed after the run; nothing written to HOME     | At source, and by execution (probe) |

C2: the `instructions` field is a fixed 453-character string, `[453, 453]` from a shallow and a
deep working directory. C3: no byte outside the protocol on stdout, in the probe or in any case.
C4: see the cases below.

#### 2.5b Build/test-stage cases, by execution

The cases are in `eval/cases/build-test.json`, committed before any run. Each runs one tool call
on a fresh copy of a fixture, in its own server process, inside the pinned container with no
network, a read-only root and a non-root user. forge and solc 0.8.37 are pinned by sha256, and
forge-std by commit and file digest. The expectations come from each fixture's ground truth,
confirmed with forge. Every case also requires nothing but the protocol on stdout and no process
left behind.

| Group                                                                                                                                                                                                                                                         | Cases  | forge 1.8.5   | forge 1.8.6   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------- |
| Results match the ground truth: exact counts, and each failing test's name, reason and kind; a fuzz counterexample of at least 2^128 (F06); the invariant call order (F07). Fixtures F01, F02, F05, F06, F07, F09, F11                                        | 7      | pass          | pass          |
| Run health (C4): an error with a code, never a clean result, for a compile error, a project without `foundry.toml` (`run_tests` and `build`), a filter that matches nothing and a missing forge; `build` places the compile error at `src/Broken.sol` line 13 | 6      | pass          | pass          |
| Size budget: 200 failures stay within 8 KiB by default and 2 KiB at the minimum, with exact counts and a note saying what was left out (F13)                                                                                                                  | 2      | pass          | pass          |
| FFI: `foundry.toml` sets `ffi = true`; the server turns it off for `run_tests`, `explain_failure` and a filter that looks like a flag, and the FFI test's command never runs                                                                                  | 3      | pass          | pass          |
| Secrets: values of secret-named variables from the environment and `.env` never appear, in hex with or without `0x`, decimal, URL or token form (`run_tests`, `explain_failure`)                                                                              | 2      | pass          | pass          |
| `explain_failure`: one failing test with its reason; a malformed test name is rejected before forge runs                                                                                                                                                      | 2      | pass          | pass          |
| **Total**                                                                                                                                                                                                                                                     | **22** | **22 passed** | **22 passed** |

CI, 2026-10-26: [Eval run 40363013461](https://github.com/vschernoff/solidity-ai-kit/actions/runs/40363013461),
144 checks per forge version; the case reports are kept in `eval/results/build-test/`. The same
cases also pass 22/22 on both forge versions on macOS outside the container.

The job fails when a case fails or a dependency is missing, not only when the harness crashes.
[Eval run 40362747831](https://github.com/vschernoff/solidity-ai-kit/actions/runs/40362747831)
showed both on purpose, from a throwaway commit that was then reverted: without forge-std both
forge jobs stopped before any case ran, and a case that could not pass failed the job at the gate.
An earlier run on the same branch reported 4/22 because forge was not reachable inside the
container. That was the harness, not the server; the job now stops when a required binary does
not run.

#### 2.5c Not verified

- forge versions other than 1.8.5 and 1.8.6. The server refuses forge older than 1.8.5. It reports
  1.9 and later as untested, and a pre-release build too, unless the build's commit is that of a
  tested release (for example 1.8.6-dev built from the 1.8.6 commit).
- Windows and macOS in CI (the evaluation runs on Linux only), the timeout path and the output cap.
- Agent trials are not recorded here.

## 3. Not yet done

- Agent trials (an agent using each component in a real client, scored from transcripts) are run
  by hand and not yet recorded. The manifest `score` for `solhint-mcp` is the lint-stage pass rate
  (21/21), and for `forge-test-mcp` the build/test-stage pass rate (22/22), not a weighted score.
- Static-analysis, fuzzing and on-chain-read stage cases do not exist yet.
- Fixture lint rule lists and analyser detector ids that have not been run are labelled
  `to-confirm` in the fixtures and are not scored.

## 4. Re-evaluation

Every pinned component is re-checked on each new version it publishes, quarterly, and whenever its
tool list changes (the probe snapshots it). A manifest change needs the evidence here first.
