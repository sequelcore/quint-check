# Changelog

All notable changes to quint-check, called quint-ts until 0.1.0-alpha.1, are
recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change the API, the command line or the result format.

## [Unreleased]

### Added

- `Bool`, the set of Booleans, in the supported subset. Quint's `ewd840` and
  `prisoners` examples now check with their authors' invariants.
- Lists: literals, `append`, `concat`, `head`, `tail`, `length`, `nth` and
  `indices`, as TLA+ sequences. `head` and `tail` of an empty list, and `nth`
  outside the list, answer `unsupported`, since Quint leaves them undefined.
  A counterexample shows a list as `[1, 2]`, and ITF writes it as a JSON array.

### Changed

- The demo's refused model is now `mutex_pairs.qnt`, which uses `powerset`.

## [0.1.0-alpha.2] - 2026-11-08

The first version on npm, as `@sequelcore/quint-check` under the `alpha`
dist-tag, with provenance: `npm install @sequelcore/quint-check@alpha`. Its
checking, command line and results are those of 0.1.0-alpha.1.

The documentation moved from the README to `docs/`, which ships in the package:
a quickstart, what a result means, references for the command line, the API,
counterexamples and the supported subset, and how a check runs.

### Changed

- quint-ts is now quint-check: the package is `@sequelcore/quint-check`, the
  command is `quint-check`, and the repository is `sequelcore/quint-check`.
  The environment variables are `QUINT_CHECK_CACHE` and
  `QUINT_CHECK_CACHE_DIR`, and the cache and temporary folders start with
  `quint-check`. Nothing reads the old names: `quint-ts cache clear`, run
  before upgrading, removes the old cache.

## [0.1.0-alpha.1] - 2026-11-08

The first release. It checks safety invariants of Quint models in a subset of
the language, with Quint's own frontend and the tla-ts model checker, on Node
and without Java.

### Added

#### Checking

- `check(file, options)` checks every invariant in `options.invariants` in
  every reachable state and returns a promise of the result. It runs Quint's
  frontend and the checker in child processes; `timeoutMs` (60 000 by
  default) bounds the whole check, and aborting `signal` stops it.
- A result's `status` is `passed`, `violated`, `unsupported`, `inconclusive`
  or `error`. `passed` comes only from a complete search, with at least one
  initial state and no state left queued.
- `violated` names the invariant that broke, as it was given, and carries the
  shortest counterexample the search found.
- `unsupported` says which construct is outside the subset, and whether it
  was found during translation or in a reachable state. Such a model never
  passes.
- `inconclusive` gives its reason: `timeout` or `no-initial-state`.
- `error` gives the stage that failed: `frontend`, `translation` or
  `checker`.
- `passed` and `violated` carry `search`: the initial, distinct and queued
  states when the search ended.
- Every result carries `guarantee`: the method, the property, the scope
  (`complete`, `partial` or `none`), the frontend and checker with their
  versions, and that deadlock is not checked.
- A check with no invariant, a blank one or `true` is refused before it
  runs, since it would pass without checking anything.

#### Command line

- `quint-ts check <file.qnt> --invariant <expr>` prints a summary with the
  verdict on its last line, and the next command, if any, on stderr.
  `--invariant` can be given more than once.
- `--json` prints the result exactly as `check()` returns it.
- `--main`, `--init` and `--step` choose the module and actions, and
  `--timeout-ms` sets the time limit.
- The exit code gives the status: 0 passed, 20 violated, 21 unsupported, 22
  inconclusive, 23 error, 2 usage error, 1 crash, 130 interrupted and 143
  terminated.
- `quint-ts translate` prints the TLA+ module and configuration that `check`
  would run. `quint-ts cache path` and `quint-ts cache clear` show and remove
  the checker's compile cache.
- `--help`, `<command> --help` and `--version`. An unknown or incomplete flag,
  or a single-value flag given twice, is a usage error.

#### Counterexamples

- A violation's `trace` is an ITF document, as `quint run --out-itf` writes
  it, with each state variable under its full Quint name.
- `check --out-itf <file>` writes it to a file on a violation, and writes
  nothing on any other result.
- The summary prints the trace in Quint's syntax: the first state whole, then
  only the variables each step changed.

#### Supported subset

- Integers within the checker's 32-bit range, Booleans and strings.
- Sets; maps with literal keys, `get`, `set`, `put`, `setBy`, `keys`,
  `mapBy` and `setOfMaps`.
- Records, including `with`, spread, `fieldNames` and nesting.
- Tuples of two or more items, including `tuples` and unpacking.
- Sum types and `match`, `fold` as a sum, `all`, `any`, `nondet … oneOf`,
  `if`, parameterized actions, and instances with constants.

### Known limitations

These are refused with `unsupported`, never checked:

- Temporal properties, lists, `Bool` and the other built-in sets, `then`,
  `powerset`, `ipow`, `chooseSome`, a `fold` that isn't a sum, and
  uninstantiated constants.
- `/` and `%` on negative operands, whose value Quint's sources disagree on
  ([quint-co/quint#2070](https://github.com/quint-co/quint/issues/2070)).
- `get`, `set` or `setBy` on a key the map lacks, where a state reaches it.
- An init that reads a state variable.
- A record with no fields, a field name that can't name a TLA+ record field,
  the empty tuple outside a variant's payload, a tuple of one item, and
  `tuples` of fewer than two sets.
- Two Quint names that would become one TLA+ name.
- Deadlock isn't checked, as in `quint verify --backend=tlc`.

[0.1.0-alpha.2]: https://github.com/sequelcore/quint-check/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/sequelcore/quint-ts/releases/tag/v0.1.0-alpha.1
