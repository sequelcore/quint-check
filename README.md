# quint-check

Check the safety invariants of [Quint](https://github.com/quint-co/quint)
models from Node.js, without Java.

```text
.qnt → Quint's own frontend → a TLA+ translation of a supported subset → tla-ts
     → passed | violated | unsupported | inconclusive | error
```

quint-check is independent: not official, and not affiliated with or
endorsed by Quint or Informal Systems.

- **It checks a subset of Quint, and says so.** A model outside the subset
  gets `unsupported`, never a pass. [The subset](docs/subset.md) lists what
  is checked and what is refused.
- **A `passed` means every reachable state was explored.** It is
  explicit-state checking with [tla-ts](https://github.com/aidenybai/tla-ts),
  not `quint verify`'s symbolic, bounded or inductive checks. Safety
  invariants only: no temporal properties, and no deadlock check.
- **Quint parses and typechecks the model.** quint-check has no parser of
  its own.

**Status:** experimental. Any release before 1.0.0 may change the API, the
command line or the result format; the [changelog](CHANGELOG.md) records
each change.

## Install

You need Node 24 or later.

```sh
npm install @sequelcore/quint-check@alpha
```

## Check a model

The package ships a demo: three processes share a lock, and `inv` says at
most one is in the critical section.

```sh
npx quint-check check node_modules/@sequelcore/quint-check/demo/mutex.qnt --main mutex --invariant inv
```

```text
search: complete, 20 distinct states from 1 initial state; deadlock not checked
checked with quint 0.33.1 and tla-ts 0.0.9
passed: inv holds in all 20 reachable states
```

The exit code gives the status: 0 passed, 20 violated, 21 unsupported, 22
inconclusive, 23 error. `--json` prints the result as JSON.

From TypeScript or JavaScript:

```ts
import { check } from "@sequelcore/quint-check";

const result = await check("spec.qnt", { main: "spec", invariants: ["inv"] });
if (result.status === "violated") console.log(`${result.invariant} breaks`, result.trace);
```

## Documentation

| Page | Read it to |
| --- | --- |
| [Quickstart](docs/quickstart.md) | Check the three demo models and read each answer |
| [What a result means](docs/results.md) | Know what each status guarantees, and what it doesn't |
| [Command line](docs/cli.md) | Look up `check`, `translate`, `cache`, their flags and exit codes |
| [TypeScript API](docs/api.md) | Look up `check()`, its options and `CheckResult` |
| [Counterexamples](docs/counterexamples.md) | Read a violation's trace, as ITF or in the summary |
| [The supported subset](docs/subset.md) | See which Quint constructs are checked and which are refused |
| [Processes, files and the cache](docs/operations.md) | Know what a check runs, writes and leaves behind |
| [Changelog](CHANGELOG.md) | See what changed in each version |
| [Contributing](https://github.com/sequelcore/quint-check/blob/main/CONTRIBUTING.md) | Build, test and run the conformance harness |

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
