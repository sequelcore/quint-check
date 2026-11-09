# Benchmarks

`bun run bench [--runs N]` times quint-check against TLC and Quint's own TLC
route, and writes `bench/BASELINE.md` from the results of every
platform and machine in `results/`. Correctness comes first: a model's timings are kept
only when every route reaches the expected verdict in every run, with the
same number of distinct states for a pass and the same counterexample length
for a violation. Otherwise the model is reported as not comparable.

## Equivalent guarantees

Every route runs explicit-state search of every reachable state, checks
safety invariants only, doesn't check deadlock (`-deadlock`, as
`quint verify --backend=tlc` does), and uses one worker. Apalache's own
symbolic check (`quint verify` without `--backend=tlc`) gives a different
guarantee, bounded and symbolic, so it isn't compared.

| Route | What it times |
| --- | --- |
| `quint-check` | `quint-check check`: Quint's frontend (Node), the translation, tla-ts, with tla-ts's compile cache warm |
| `quint-check-nocache` | The same with `QUINT_CHECK_CACHE=off`: tla-ts compiles itself on every check, as quint-check did before the cache |
| `tla-ts` | tla-ts alone on quint-check's TLA+ |
| `tlc-qc` | TLC from Apalache's jar on the same TLA+, so the checkers compare on one input |
| `tlc-apalache` | That TLC on Apalache's translation, the TLA+ that `quint verify --backend=tlc` checks |
| `quint-verify-tlc` | `quint verify --backend=tlc` end to end, starting its Apalache server |

`bun bench/compare.ts` writes `bench/COMPARISON.md`: each results
file against the one of the same platform and machine in `results/baseline/`.

## Measures

- **Latency:** wall clock, including each tool's startup (Bun, Node, the
  JVM). For a violated model it is the time to the counterexample.
- **States per second:** distinct states over the median wall time, for the
  checker-only routes of a passing model. It includes startup, so a small
  model understates it.
- **Memory:** on Windows, the peak committed memory of the whole process
  tree, from a Job Object (`measure.ps1`), so Java started by Quint counts.
  On Linux and macOS, the peak resident set of the largest process, from
  `/usr/bin/time`. The two aren't the same measure; compare within a
  platform.
- **Method:** one warm-up run per route, then `--runs` repetitions (5 by
  default) with the routes in a rotated order. Medians, with minimum and
  maximum.

## Models

`models/stock.qnt` scales the reservation model with its constants:
`stock_small` (1,820 states), `stock_large` (46,376), and `stock_deep_fault`,
whose counterexample comes after every unit is reserved. `tokens` comes from
the conformance corpus.

## Limits

- One file per operating system and machine (`<platform>-<arch>-<machine>.json`, the machine from `QUINT_CHECK_MACHINE` or the CPU model); numbers don't transfer between machines. A GitHub-hosted runner's hardware can change between runs.
- Run nothing else heavy during a benchmark: the routes share the machine.
- The JVM's default heap applies to the TLC routes, and Quint's
  `quint verify` uses its own default (`-Xmx8G`); memory follows those
  settings.
