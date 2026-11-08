# quint-ts

A Java-free model checker for [Quint](https://github.com/quint-co/quint)
specifications, for Node.js. **Experimental:** not published, no
compatibility promised.

quint-ts is an independent project. It is not official, and not affiliated
with or endorsed by Quint or Informal Systems.

```text
.qnt → Quint's official frontend (quint compile --target json: parse, typecheck, flatten)
     → a translation of a supported subset to TLA+ (anything else is refused)
     → tla-ts, an explicit-state model checker in TypeScript
     → passed | violated | unsupported | inconclusive | error
```

## What it is, and what it isn't

- **It uses Quint's own frontend.** quint-ts has no parser of its own: Quint
  parses, typechecks and flattens the model.
- **Its backend is explicit-state model checking** on
  [tla-ts](https://github.com/aidenybai/tla-ts): it enumerates every reachable
  state. There's no symbolic backend like Apalache's, so `quint verify`'s
  bounded and inductive checks have no equivalent here.
- **It doesn't support all of Quint.** It checks safety invariants on finite
  models in a subset of the language; a model outside the subset gets
  `unsupported`, never a pass.
- **A `passed` needs a complete search:** every reachable state explored,
  under the semantics of the subset, with every operator confirmed by the
  conformance harness against Quint's own tools.
- **No Java, no Bun.** It runs on Node. Java is needed only to run the
  conformance harness, which compares quint-ts with Quint's official route.

## Try it from this repository

quint-ts isn't published on npm yet. To try it, build a package from a clone
and install that package into a project of your own. You need Node 24 or
later, npm and Git. You don't need Bun or Java.

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/sequelcore/quint-ts.git
   cd quint-ts
   npm install
   ```

2. Build the package. `npm pack` compiles `src/` to `dist/` and writes
   `quint-ts-0.0.0.tgz`:

   ```sh
   npm pack
   ```

3. In another folder, create a project and install the package into it:

   ```sh
   mkdir ../my-project
   cd ../my-project
   npm init -y
   npm install ../quint-ts/quint-ts-0.0.0.tgz
   ```

4. Check the demo's correct model, which ships in the package:

   ```sh
   npx quint-ts check node_modules/quint-ts/demo/mutex.qnt --main mutex --invariant inv
   ```

   The result is JSON, with `"status": "passed"`, `"states": 20` and
   `"scope": "complete"`.

To check your own model, run `npx quint-ts check spec.qnt --main spec
--invariant inv`. The direct dependencies are pinned to exact versions in
`package.json`. `npm install` resolves their own dependencies again, so the
fully pinned install is the development one, `bun install
--frozen-lockfile` (see [Developing](#developing)).

`check` prints the result as JSON. Its exit code says what happened: 0 passed,
20 violated, 21 unsupported, 22 inconclusive, 23 error, 2 usage error, 1 crash,
130 interrupted (SIGINT) and 143 terminated (SIGTERM). `quint-ts --help`,
`quint-ts <command> --help` and `quint-ts --version` print help and the
version.
It needs at least one `--invariant`, an invariant of the model as `quint
compile --invariant` takes it; give the flag again for more. A blank
invariant or `true` checks nothing, so `check` refuses it, as it refuses an
unknown or incomplete flag, or a single-value flag given twice: a usage error
prints a message and exits 2.
`--timeout-ms` is the time limit in milliseconds, from 1 to 2 147 483 647 (60 000
by default).

From TypeScript or JavaScript:

```ts
import { check } from "quint-ts";

const result = await check("spec.qnt", { main: "spec", invariants: ["inv"] });
if (result.status === "passed") console.log(`${result.states} states, scope ${result.guarantee.scope}`);
if (result.status === "violated") console.log(result.trace);
```

`check` returns a promise. It rejects with a `TypeError`, and checks nothing,
when `invariants` is empty or holds a blank entry or `true`; with a
`RangeError` when `timeoutMs` isn't a whole number from 1 to 2147483647;
and with the signal's reason when `signal` aborts. `timeoutMs` bounds the
whole check, Quint's frontend included.

The [demo](demo/README.md) shows the three kinds of answer on one model.

## What a result means

| Status | Meaning |
| --- | --- |
| `passed` | Every reachable state was explored and the invariants hold in each. `guarantee.scope` is `complete`. |
| `violated` | An invariant breaks. `invariant` is the one you passed, as you wrote it; `trace` is a shortest counterexample, in Quint's names. |
| `unsupported` | The model uses a construct outside the subset (`where: "translation"`), or a reachable state needs an operation whose result Quint leaves undefined or disputed, or an integer outside the checker's 32-bit range (`where: "reached-state"`). Nothing was proved. |
| `inconclusive` | The search stopped before exploring every state (time limit), or there was no initial state. |
| `error` | The Quint frontend rejected the model, or the checker failed. `stage: "translation"` is a quint-ts defect. |

`invariant` names the first invariant, in the order you gave them, that the first violating state the search found breaks. It is not the first invariant that fails anywhere in the model: when `["a", "b"]` is checked and `b` breaks in an earlier state than `a`, the result names `b`. An entry with a comma, such as `"x >= 0, x <= 5"`, is one invariant, named whole.

A `passed` rests on the counts tla-ts's library reports: a `success` status,
at least one initial state, at least one distinct state, and no state left in
the queue. tla-ts's result has no field that says how many invariants it
evaluated, so quint-ts can't confirm that from the result itself.

Every result carries `guarantee`: the method (`explicit-state`), the property
(`safety-invariant`), the scope (`complete`, `partial`, `none`), the backend
and frontend versions, and that deadlock is not checked, as
`quint verify --backend=tlc` doesn't check it.

## The supported subset

Safety invariants over finite models: integers (within TLC's 32-bit range),
Booleans, strings, sets, maps (literals with literal keys, `get`, `set`,
`put`, `setBy`, `keys`, `mapBy`, `setOfMaps`), sum types (variants) and
`match`, `fold` as a sum, `all`, `any`, `nondet … oneOf`, `if`,
parameterized actions and instances with constants. `src/translate.ts` lists
the operators (`SUPPORTED_OPCODES`); an operator joins it only with a
conformance case that passes.

Outside the subset, and refused: temporal properties, records, tuples,
lists, `Bool` and the other built-in sets, `then`, `powerset`, `ipow`,
`chooseSome`, a non-sum `fold`, uninstantiated constants, and `/` or `%`
on negative operands (Quint's sources disagree on their value,
quint-co/quint#2070). `get`, `set` or `setBy` on a key the map lacks, which
Quint leaves undefined, is `unsupported` where a state reaches it. So is
an init that reads a state variable, directly or through a definition, where
init evaluates the read: Quint's evaluators reject it (QNT502), and TLC
solves it as an equation.

Of Quint's 77 public examples, 6 translate today, and 4 get a definitive
verdict with their authors' own invariants (3 passed after a complete search, 1
violated with a counterexample). The count, and what would extend it, is in
[conformance/public/README.md](conformance/public/README.md).

## Processes and temporary files

A check runs two child processes, one after the other: Quint's frontend, then
the checker, which runs tla-ts in a Worker thread. Each check works in its own
folder under the system's temporary directory, named `quint-ts-run-<pid>-...`
after the process that made it.

- **When a check settles**, every process it started has exited and its folder
  is gone. That holds when it passes, fails, times out or is cancelled. A
  folder that can't be removed, for example because another program holds a
  file in it, is reported as a process warning with the code
  `QUINT_TS_CLEANUP`, never thrown.
- **Stopping** sends SIGTERM and, 2 seconds later, SIGKILL. On Linux and macOS
  it signals the child's whole process group, so nothing it started outlives
  it. On Windows the child is ended with TerminateProcess. Processes a Node
  child starts without `detached` end with it, through the job object libuv
  puts every Node process in; processes started with `detached` leave that job
  and don't. quint-ts's own children start none.
- **The CLI** turns Ctrl-C (SIGINT) and SIGTERM into a cancel: the check stops
  every process it started, and `quint-ts` exits with 130 or 143. On Linux and
  macOS the children run in their own process group, so the terminal's signal
  reaches only the CLI.
- **If the process running `check` is killed** (SIGKILL, a crash, the
  operating system ending it), the checker notices that its standard input has
  closed and exits within moments. Quint's frontend has no such check: on Linux
  and macOS, where it runs in its own process group, it keeps running until its
  compile finishes and then exits. Either way the folder stays behind, and the
  next check in any process removes the folders of processes that no longer
  exist. A power failure leaves both the folder and nothing running; the same
  sweep removes the folder.
- **The sweep** tells a stale folder by its owner's process id. Processes in
  different PID namespaces, such as containers, that share one temporary
  folder can therefore remove each other's live folders. A check whose folder
  is removed fails closed: it reports `error` from the stage that
  lost its output, and never reports `passed`.
- **The time limit** covers the whole check. Creating and removing the folder
  happen outside it, and can add a little time to a check that ran up to its
  limit. Reading Quint's output (`frontend.json`) and translating it run in the
  process that called `check`; neither `timeoutMs` nor the signal interrupts
  them, and the check stops only once they finish.

## The checker cache

tla-ts compiles its own JavaScript on first use, and quint-ts keeps the
compiled code between checks. The Windows benchmark workflow
(`.github/workflows/bench-windows.yml`) times checks with the cache warm and
off on a hosted runner. In its run at the first commit, the warm cache took
178 to 315 ms off the median check of each of four models
([bench/results/ci](bench/results/ci/win32-x64-github-windows-2025-x64.md)). The cache holds code of
tla-ts only, never anything about a model or a result; a result is the same
with the cache off, empty, warm or corrupted (`tests/cache.test.ts`).

| | |
| --- | --- |
| Where | `QUINT_TS_CACHE_DIR`, else `%LOCALAPPDATA%\quint-ts\cache` (Windows), `~/Library/Caches/quint-ts` (macOS), `$XDG_CACHE_HOME/quint-ts` or `~/.cache/quint-ts` (Linux) |
| Layout | one folder per tla-ts version, and inside it per runtime, platform and architecture |
| Off | `QUINT_TS_CACHE=off`; also off when the folder can't be created or written |
| Clear | `npx quint-ts cache clear`; `cache path` prints the folder |

## Dependencies

| Package | Version | Role | Notes |
| --- | --- | --- | --- |
| `@informalsystems/quint` | 0.33.1 | Quint's official frontend | Published by Quint's CI with a provenance attestation |
| `tla-ts` | 0.0.8-dev.8067c48 | The model checker | A development build, see below |

Both are pinned to exact versions, and the lockfile pins their content.

**tla-ts is a development build.** `0.0.8-dev.8067c48` is
[aidenybai/tla-ts@8067c48](https://github.com/aidenybai/tla-ts/commit/8067c48004dbda038547adf1a125c835a32d16be),
the latest stable release, 0.0.8, plus three commits:

- a lexer refactor;
- a refactor of the evaluator's caches;
- `-continue` (tla-ts#358), which the conformance harness uses to explore a
  model's whole graph past its violations.

It was published to npm by tla-ts's GitHub Actions with an SLSA provenance
attestation, and `npm audit signatures` verifies it. The risks: a
development build has no stability promise, and the next stable release may
behave differently. quint-ts moves to the first stable release that includes
`-continue`, with the conformance harness run again on it.

## Performance

[bench/](bench/README.md) times quint-ts against TLC and `quint verify
--backend=tlc` under the same guarantee: every reachable state, safety
invariants only, no deadlock check, one worker. The numbers describe the
machines and models named there, nothing more, and Apalache's symbolic check
isn't compared, since its guarantee is different.

## Developing

Bun 1.4.4 is the development tool; Node 24 runs Quint's frontend.

```sh
bun install --frozen-lockfile
bun run check          # types and tests
bun run conformance    # every case through every route; needs Java for the official route
bun run build          # compiles src/ to dist/ for Node
npm run pack:check     # packs, installs into a new project, runs the demo with Node only
```

`bun run conformance` needs Java on `PATH` for the official route
(`quint verify --backend=tlc`, which downloads Apalache 0.62.4 to
`~/.quint` on first use); `--no-official` skips that route. See
[conformance/README.md](conformance/README.md) for the method. CI runs the
checks, the harness and the package check on Windows and Linux; macOS runs by
hand (`gh workflow run macOS`).

| Path | Holds |
| --- | --- |
| `src/` | The translator, the check, the CLI and the API |
| `conformance/` | The harness, its cases and models, and the generated matrix |
| `demo/` | Three versions of one model: correct, with a bug, and outside the subset |
| `bench/` | Benchmarks against TLC and Quint, and the baselines they produce |
| `repro/` | Minimal reproductions of disagreements between Quint's routes |
| `scripts/` | The package check |

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
