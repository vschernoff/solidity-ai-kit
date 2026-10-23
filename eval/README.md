# Evaluation harness

Evidence for every component choice in `kit.manifest.json` (SRS §8). The kit's value is the
curation; this directory is where the curation is checked. Scores and decisions are published
in `SCORECARD.md`.

**Status:** fixtures and ground truth only. The MCP client that drives candidate servers,
the security probes and the scoring land in later PRs.

## Fixtures

Small projects with defects planted on purpose: the ten of SRS §8.3 (F01–F10), plus
F11–F13 written with the forge-test-mcp interpreter work, which shares this set. Each has a
`GROUND_TRUTH.json` (schema: `fixtures/ground-truth.schema.json`) saying what each workflow
stage — build, test, lint, static analysis, fuzzing — must report.

| ID  | Fixture                 | Layout    | Planted                                                                                       |
| --- | ----------------------- | --------- | --------------------------------------------------------------------------------------------- |
| F01 | `erc20-clean`           | Foundry   | nothing: the false-positive and true-clean baseline                                           |
| F02 | `vault-reentrancy`      | Foundry   | pays out before zeroing the balance; an exploit test fails                                    |
| F03 | `upgradeable-proxy`     | Foundry   | unprotected `upgradeTo`; V2 storage collision. All tests pass                                 |
| F04 | `compile-error`         | Foundry   | one type error at a known line: every stage must error                                        |
| F05 | `failing-assertion`     | Foundry   | `assertEq` failure with a message                                                             |
| F06 | `failing-fuzz`          | Foundry   | overflow for `x >= 2**128`; counterexample checked by predicate                               |
| F07 | `failing-invariant`     | Foundry   | `burnFrom` skips `totalSupply`; handler invariant + Echidna property                          |
| F08 | `hardhat-only`          | Hardhat 2 | `tx.origin` auth; forge tools must say "not a Foundry project"                                |
| F09 | `mixed-foundry-hardhat` | both      | wrong fee unit, imported through a remapping                                                  |
| F10 | `broken-solhint-config` | Foundry   | invalid `.solhint.json`: lint must error, never "no violations"                               |
| F11 | `custom-error`          | Foundry   | custom errors with and without args, expectRevert mismatches, panics, an undecodable selector |
| F12 | `ffi-disabled`          | Foundry   | `vm.ffi` under `ffi = false`: the test fails and `ffi-marker.txt` must not exist              |
| F13 | `many-failures`         | Foundry   | 200 failing tests across 4 suites: response size budgets and truncation                       |

Every planted defect carries a `// @gt:<id>` comment on the line `GROUND_TRUTH.json` names;
a test checks the two agree both ways.

### How each expectation is known

Each expectation has a `label`:

- `planted` — true by construction.
- `confirmed-by:<tool>@<version>` — checked by running that tool.
- `known-miss:<tool>` — the tool is expected **not** to report it (e.g. Solhint and
  reentrancy). Recorded so no output ever implies coverage it does not have (SRS C5).
- `to-confirm` — not established yet. Never scored until it becomes one of the above.

## Running

```bash
node --test 'eval/test/*.test.js'           # schema, markers, layouts; no toolchain needed
node eval/scripts/fetch-deps.mjs            # forge-std at the pinned commit, sha256-checked
node eval/scripts/confirm-ground-truth.mjs  # needs forge at the version in deps.json
```

`confirm-ground-truth.mjs` copies each Foundry fixture to a temp directory, runs
`forge build --json`, `forge test --json` and, for F03, `forge inspect … storageLayout`, and
compares the results with the ground truth. Any output it cannot parse counts as a mismatch,
never as a pass. A forge version other than the one in `deps.json` fails the run.

CI runs all three on Linux only (`.github/workflows/EVAL.yml`, decision D16). Pinned
versions live in `deps.json`; a test keeps the workflow in step with it.

## Rules

- Fixtures are self-contained: no git submodules, no `forge install`, no npm packages at
  build time. forge-std is fetched at a pinned commit and never committed (`(Apache-2.0 OR MIT)`).
- FFI is off in every fixture config (`ffi = false`, `allowFFI: false`; SRS NFR-11).
- Scripts use `execFile` with argument arrays and an allow-listed environment: no keys,
  RPC URLs or tokens reach the tools.
- Nothing here proves a contract secure. The fixtures measure whether tools report what is
  planted, and whether they say so when they could not run (SRS C4, C5).

## Differences from the design note

- F08 does not commit a Hardhat `artifacts/` directory; the "tools must not write into
  `artifacts/`" check moves to the harness, which looks at the file-system diff instead.
- F09 remaps `@shared/` to a local library instead of `@openzeppelin/`, so it needs no network.
- Lint rule lists and Slither detector ids that have not been run yet are labelled
  `to-confirm` rather than guessed.
