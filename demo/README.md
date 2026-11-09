# Demo

Three versions of one Quint model: three processes share one lock, and the
invariant `inv` says at most one is in the critical section at a time. The
package ships the three `.qnt` files, and the [quickstart](../docs/quickstart.md)
checks each one from an installed package.

| File | What it is | quint-check's answer |
| --- | --- | --- |
| [mutex.qnt](mutex.qnt) | The correct model, with a sum type for each process's phase (`Idle \| Waiting \| Critical`) | `passed`: all 20 reachable states explored, `inv` holds in each |
| [mutex_bug.qnt](mutex_bug.qnt) | A deliberate bug: `enter` doesn't check that the lock is free | `violated`, with a counterexample in which two processes enter |
| [mutex_pairs.qnt](mutex_pairs.qnt) | The correct model, with its invariant stated over every pair of processes from `powerset` | `unsupported`: `powerset` is outside quint-check's subset, so it proves nothing rather than guess |

In this repository, `bun demo/run.ts` checks all three through the API and
prints a summary, and `node dist/cli.js check demo/mutex.qnt --main mutex
--invariant inv` runs the CLI after `bun run build`.
