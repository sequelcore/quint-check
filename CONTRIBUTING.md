# Contributing

Bun 1.4.4 is the development tool, and Node 24 runs Quint's frontend. Agents
also read [AGENTS.md](AGENTS.md), which holds the rules a change must keep.

## Build and test

```sh
bun install --frozen-lockfile
bun run check          # types and tests
bun run conformance    # every case through every route; needs Java for the official route
bun run build          # compiles src/ to dist/ for Node
npm run pack:check     # packs, installs into a new project, runs the docs' commands with Node only
```

`bun run conformance` needs Java on `PATH` for the official route,
`quint verify --backend=tlc`, which downloads Apalache 0.62.4 to `~/.quint`
on first use; `--no-official` skips that route.
[conformance/README.md](conformance/README.md) describes the method, and the
generated [conformance/MATRIX.md](conformance/MATRIX.md) the last run on each
platform.

CI runs the checks, the harness and the package check on Windows and Linux
for every pull request and merge-queue group. macOS runs by hand, once per
pull request that can behave differently there: `gh workflow run macOS`.

## A change to the subset

The conformance harness changes before the translator. An operator joins
`SUPPORTED_OPCODES` in `src/translate.ts` only with a case in
`conformance/operators.ts`, or a model in `conformance/models.ts`, that
passes, and `tests/coverage.test.ts` enforces it. Update
[docs/subset.md](docs/subset.md) and the changelog in the same change.

## Dependencies

| Package | Version | Role |
| --- | --- | --- |
| `@informalsystems/quint` | 0.33.1 | Quint's official frontend, published with a provenance attestation |
| `tla-ts` | 0.0.9 | The model checker, published with an SLSA provenance attestation |

Both are pinned to exact versions in `package.json`, and the lockfile pins
their content. `npm install` resolves their own dependencies again, so the
fully pinned install is `bun install --frozen-lockfile`. `npm audit
signatures` verifies both attestations.

tla-ts 0.0.9 is the first stable release with `-continue`
([tla-ts#358](https://github.com/aidenybai/tla-ts/pull/358)), which lets the
conformance harness explore a model's whole graph past its violations;
quint-check's own checks never set it.

## Try a checkout without Bun

To try a checkout with Node and npm only, pack it and install the tarball
into a project of your own:

```sh
git clone https://github.com/sequelcore/quint-check.git
cd quint-check
npm install
npm pack
mkdir ../my-project
cd ../my-project
npm init -y
npm install ../quint-check/sequelcore-quint-check-0.1.0-alpha.2.tgz
```

`npm pack` compiles `src/` to `dist/` and writes the tarball, named after the
version in `package.json`.

## Benchmarks

[bench/](bench/README.md) times quint-check against TLC and `quint verify
--backend=tlc` under the same guarantee: every reachable state, safety
invariants only, no deadlock check, one worker. The numbers describe the
machines and models named there, nothing more. Apalache's symbolic check
isn't compared, since its guarantee is different.

## Releases

A `v<version>` tag runs `.github/workflows/release.yml`: it checks that the
tag matches the version, builds and tests the package once, stages that
tarball on npm under the `alpha` dist-tag with provenance, and drafts the
GitHub release from the changelog. A maintainer approves the `npm`
environment, then the staged version on npm with 2FA.

## Where things are

| Path | Holds |
| --- | --- |
| `src/` | The translator, the check, the CLI and the API |
| `docs/` | The user documentation, shipped in the package |
| `conformance/` | The harness, its cases and models, and the generated matrix |
| `demo/` | Three versions of one model: correct, with a bug, and outside the subset |
| `bench/` | Benchmarks against TLC and Quint, and the baselines they produce |
| `repro/` | Minimal reproductions of disagreements between Quint's routes |
| `scripts/` | The package check |
