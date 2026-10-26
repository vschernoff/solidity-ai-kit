# Evaluation harness

Evidence for every component choice in `kit.manifest.json` (SRS §8). The kit's value is the
curation; this directory is where the curation is checked. Scores and decisions are published
in `SCORECARD.md`.

**Status:** fixtures with forge-confirmed ground truth, the MCP probe, and lint-stage and
build/test-stage cases. Scoring and the other stages' cases land in later PRs.

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
| F14 | `missing-plugin`        | Foundry   | `.solhint.json` names a plugin that is not installed: lint must say its rules did not run     |
| F15 | `unknown-rule`          | Foundry   | `.solhint.json` enables a rule id that does not exist: lint must say it did not run           |
| F16 | `chatty-plugin`         | Foundry   | a plugin (planted at run time) prints chatter: not a degraded run, nothing on MCP stdout      |

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

### Stage cases

`cases/<stage>.json` lists tool calls against fixtures, each with expectations that any server for
that stage must meet: `isError`, text it must or must not contain, and that no planted marker
module was loaded as code. `scripts/run-cases.mjs` runs every case with a fresh fixture copy and
its own server process, in the same no-network container as the probe (EVAL.yml). A failed case
is a result in the report, not a harness failure.

`cases/lint.json` covers:

- F10: invalid config is an error;
- F14/F15: the lint and `get_config` must name the plugin or rule that did not run, with and
  without `FORCE_COLOR`, and `get_config` must not claim "✅";
- F16: a plugin that prints chatter must not be reported as a problem, and nothing may reach
  the MCP stdout channel;
- code loading from an agent-supplied `config`: `extends` absolute, array, `solhint:../`
  traversal, relative; `plugins`; `plugins` + `pluginPaths`; `fix_solidity` (SRS NFR-11).

`cases/build-test.json` covers, on forge 1.8.5 and 1.8.6:

- results against each fixture's ground truth (`groundTruth`): exact passed/failed counts, and
  each failing test named with its reason, kind, fuzz counterexample bound and invariant call
  order (F01, F02, F05–F07, F09, F11, F12);
- run health (C4): a compile error, a project without `foundry.toml`, a filter that matches
  nothing and a missing forge are each an error with a code, never a clean result;
- the size budget (FR-32): F13's 200 failures within the default and the smallest budget;
- FFI (FR-38a): `ffi = true` planted in `foundry.toml`, and the FFI test's command never runs;
- redaction (D24): secret-named values from the environment and `.env`, in every printed form.

Every case also requires nothing but JSON-RPC on stdout and no process left behind. The cases
need forge on `PATH` and a solc 0.8.37 binary, passed as `SAK_SOLC` (the file's shared `env`
sets `FOUNDRY_SOLC` from it, so nothing is downloaded at run time). Before any case runs,
`run-cases.mjs` runs each of the candidate's `requiresBinaries` and each binary named in
`binariesInEnv` with `--version`; if one does not run, it exits 2, so a broken toolchain fails the
job instead of becoming case results. The same holds for fixture dependencies the cases file
lists in `fixtureDeps`: forge-std must be at the pinned commit and unchanged since `fetch-deps.mjs`
installed it from the sha256-checked tarball (it records a digest of the files):

```bash
node eval/scripts/install-candidate.mjs forge-test-mcp /tmp/ftm
SAK_SOLC=/path/to/solc-0.8.37 node eval/scripts/run-cases.mjs forge-test-mcp /tmp/ftm
```

`run-cases.mjs` exits 0 whenever it wrote a report, because a failed case is a result. In CI,
`scripts/gate-cases.mjs` then fails the job unless the failed cases are exactly the candidate's
declared `expectedFailures` (each with a reason; empty for every current candidate). A declared
failure that passes fails the gate too, so the list cannot go stale. The step summary and the
artifacts are kept either way.

In CI, `scripts/fetch-solc.mjs` fetches the Linux solc pinned in `deps.json` (sha256-checked) and
the forge versions in `deps.json` `foundry.caseVersions` each get a job. Dated results are kept
in `results/build-test/`.

### Forge behaviour the comparer depends on (checked by execution)

- forge 1.8.x puts an invariant failure's reason and call sequence in `invariant_failures[]`,
  with the sequence as `[originalLength, [calls]]`; the top-level fields are null.
- forge 1.7.1 differs: `forge build --json` exits 0 on a compile error, and a test filter
  matching nothing prints plain text. The comparer is written for the pinned version; a run on
  any other version fails before comparing (`deps.json`).
- Without `--offline`, forge may look up unknown selectors at `api.4byte.sourcify.dev`; the
  test run uses `--offline` (the build before it fetches solc).
- `FOUNDRY_FFI=false` in the environment does not override `ffi = true` in `foundry.toml`.
  Fixtures keep `ffi = false` in the file itself.

(Versions 1.8.6 and 1.7.1 were run by the forge-test-mcp work on the same fixtures.)

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
