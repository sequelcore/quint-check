# Demo

Three versions of one Quint model, checked by quint-ts: three processes
share one lock, and the invariant `inv` says at most one is in the critical
section at a time.

| File | What it is | quint-ts's answer |
| --- | --- | --- |
| [mutex.qnt](mutex.qnt) | The correct model, with a sum type for each process's phase (`Idle \| Waiting \| Critical`) | `passed`: all 20 reachable states explored, `inv` holds in each |
| [mutex_bug.qnt](mutex_bug.qnt) | A deliberate bug: `enter` doesn't check that the lock is free | `violated`, with a counterexample in which two processes enter |
| [mutex_tuple.qnt](mutex_tuple.qnt) | The correct model with the lock kept as a tuple | `unsupported`: tuples are outside quint-ts's subset, so it proves nothing rather than guess |

## Run it

From this repository, with Node 24 and the package built (`bun run build`, or
`npm pack`, which builds it):

```sh
node dist/cli.js check demo/mutex.qnt --main mutex --invariant inv
node dist/cli.js check demo/mutex_bug.qnt --main mutex_bug --invariant inv
node dist/cli.js check demo/mutex_tuple.qnt --main mutex_tuple --invariant inv
```

From an installed package, the same models ship in it:

```sh
npx quint-ts check node_modules/quint-ts/demo/mutex.qnt --main mutex --invariant inv
```

In development, `bun demo/run.ts` runs all three and prints a summary. None of these needs Java, and the
installed package doesn't need Bun (`npm run pack:check` checks it).

## Reading the results

- **`passed`** comes only after an explicit-state search of every reachable
  state; its `guarantee.scope` is `complete`.
- **`violated`** prints the counterexample: the shortest path to a state that
  breaks `inv`. Its scope is `partial` because the search stops there.
  Values are printed as TLC prints them: a Quint map shows as
  `[p1 |-> ..., ...]`, `true` as `TRUE`, and a variant in the encoding both
  quint-ts and Quint's TLC route use, so `Idle` shows as
  `[Idle |-> [tag |-> "UNIT"]]` and `Busy(1)` as `[Busy |-> 1]`.
- **`unsupported`** says which construct is outside the subset. Nothing was
  checked, and the result never reads as a pass.
- Deadlock isn't checked, as in `quint verify --backend=tlc`.

## What quint-ts uses, and what it isn't

- **Quint's own frontend.** quint-ts parses, typechecks and flattens a model
  with `quint compile --target json`, the official tool, then translates the
  result to TLA+ and checks it with tla-ts. It has no parser of its own.
- **No Java, and no Bun once installed.** quint-ts runs on Node. The JVM is
  needed only by the conformance harness (`bun run conformance`), which
  compares quint-ts with Quint's official route, `quint verify
  --backend=tlc` (Apalache and TLC, on Java). The demo and `quint-ts check`
  don't run that route.
- **Not a replacement for Quint's tools.** It checks safety invariants on
  finite models in a subset of Quint: no temporal properties, tuples or
  lists yet, and no symbolic backend like Apalache's. For those, use
  `quint verify`.
