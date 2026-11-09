# quint-check

A Java-free model checker for [Quint](https://github.com/quint-co/quint)
specifications, for Node.js. **Experimental:** not published, no
compatibility promised.

quint-check is an independent project. It is not official, and not affiliated
with or endorsed by Quint or Informal Systems.

```text
.qnt → Quint's official frontend (quint compile --target json: parse, typecheck, flatten)
     → a translation of a supported subset to TLA+ (anything else is refused)
     → tla-ts, an explicit-state model checker in TypeScript
     → passed | violated | unsupported | inconclusive | error
```

## What it is, and what it isn't

- **It uses Quint's own frontend.** quint-check has no parser of its own: Quint
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
  conformance harness, which compares quint-check with Quint's official route.

## Try it from this repository

quint-check isn't published on npm yet. To try it, build a package from a clone
and install that package into a project of your own. You need Node 24 or
later, npm and Git. You don't need Bun or Java.

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/sequelcore/quint-check.git
   cd quint-check
   npm install
   ```

2. Build the package. `npm pack` compiles `src/` to `dist/` and writes
   `sequelcore-quint-check-0.1.0-alpha.2.tgz`:

   ```sh
   npm pack
   ```

3. In another folder, create a project and install the package into it:

   ```sh
   mkdir ../my-project
   cd ../my-project
   npm init -y
   npm install ../quint-check/sequelcore-quint-check-0.1.0-alpha.2.tgz
   ```

4. Check the demo's correct model, which ships in the package:

   ```sh
   npx quint-check check node_modules/@sequelcore/quint-check/demo/mutex.qnt --main mutex --invariant inv
   ```

   The last line it prints is `passed: inv holds in all 20 reachable states`.

To check your own model, run `npx quint-check check spec.qnt --main spec
--invariant inv`. The direct dependencies are pinned to exact versions in
`package.json`. `npm install` resolves their own dependencies again, so the
fully pinned install is the development one, `bun install
--frozen-lockfile` (see [Developing](#developing)).

`check` prints a summary on stdout, with the verdict on the last line: the
search, the tools, and for a violation the counterexample in Quint's syntax:
its first state whole, then only the variables each step changed (the whole
states are in `--json` and `--out-itf`).
When there is a next command, such as a rerun with more time, it goes to
stderr. `--json` prints the result as JSON instead, the same object the
TypeScript API returns. Its exit code says what happened: 0 passed,
20 violated, 21 unsupported, 22 inconclusive, 23 error, 2 usage error, 1 crash,
130 interrupted (SIGINT) and 143 terminated (SIGTERM). `quint-check --help`,
`quint-check <command> --help` and `quint-check --version` print help and the
version.
It needs at least one `--invariant`, an invariant of the model as `quint
compile --invariant` takes it; give the flag again for more. A blank
invariant or `true` checks nothing, so `check` refuses it, as it refuses an
unknown or incomplete flag, or a single-value flag given twice: a usage error
prints a message and exits 2.
`--timeout-ms` is the time limit in milliseconds, from 1 to 2 147 483 647 (60 000
by default). `--out-itf <file>` writes a violation's counterexample to a file
as ITF (see [Counterexamples](#counterexamples)); on any other result it writes
nothing and leaves an existing file as it was. Its folder must exist, which
`check` checks before the search; if the file can't be written after a
violation, `check` still prints the result and exits 23.

From TypeScript or JavaScript:

```ts
import { writeFile } from "node:fs/promises";
import { check } from "@sequelcore/quint-check";

const result = await check("spec.qnt", { main: "spec", invariants: ["inv"] });
if (result.status === "passed") console.log(`${result.search.distinctStates} states, scope ${result.guarantee.scope}`);
if (result.status === "violated") await writeFile("spec.itf.json", JSON.stringify(result.trace));
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
| `violated` | An invariant breaks. `invariant` is the one you passed, as you wrote it; `trace` is a shortest counterexample, as ITF. |
| `unsupported` | The model uses a construct outside the subset (`where: "translation"`), or a reachable state needs an operation whose result Quint leaves undefined or disputed, or an integer outside the checker's 32-bit range (`where: "reached-state"`). Nothing was proved. |
| `inconclusive` | `reason: "timeout"`: the time limit ran out before every state was explored. `reason: "no-initial-state"`: init has no satisfying state, so nothing was checked. |
| `error` | The Quint frontend rejected the model, or the checker failed. `stage: "translation"` is a quint-check defect. |

`invariant` names the first invariant, in the order you gave them, that the first violating state the search found breaks. It is not the first invariant that fails anywhere in the model: when `["a", "b"]` is checked and `b` breaks in an earlier state than `a`, the result names `b`. An entry with a comma, such as `"x >= 0, x <= 5"`, is one invariant, named whole.

A `passed` rests on the counts tla-ts's library reports: a `success` status,
at least one initial state, at least one distinct state, and no state left in
the queue. tla-ts's result has no field that says how many invariants it
evaluated, so quint-check can't confirm that from the result itself.

A `passed` or `violated` result also carries `search`, the counts tla-ts
reports when its search ends: `initialStates`, `distinctStates` (initial ones
included) and `queuedStates`, the states found but not yet explored. A
`passed` has no state queued; a `violated` has the counts at the moment the
search stopped at the violation. A search stopped by the time limit reports
no counts.

Every result carries `guarantee`: the method (`explicit-state`), the property
(`safety-invariant`), the scope (`complete`, `partial`, `none`), the
`frontend` and `checker` as `{ name, version }` (`quint` and `tla-ts`), and
that deadlock is not checked, as `quint verify --backend=tlc` doesn't check
it. The type narrows `scope` by status: `complete` on `passed`, `partial` on
`violated`, and `none` or `partial` on the others.

## Counterexamples

A `violated` result's `trace` is the counterexample as an ITF document, the
[Informal Trace Format](https://apalache-mc.org/docs/adr/015adr-trace.html)
that `quint run --out-itf` writes and that Quint, the ITF Trace Viewer for VS
Code and itf-rs read. `check --out-itf` writes the same document to a file.

- `vars` lists the state variables by their full Quint names, as Quint's own
  ITF names them: `x` in the main module, `a::x` and `b::x` for two
  instances.
- Each state holds every variable, and its `#meta` gives its `index` and the
  `action` that reached it (`init` for the first state).
- Values are encoded as Quint's writer encodes them: an integer as
  `{"#bigint": "-1"}`, a set as `{"#set": [...]}`, a map as
  `{"#map": [[key, value], ...]}`, a tuple as `{"#tup": [...]}`, a record as
  an object, and a variant as `{"tag": "Busy", "value": ...}`, with
  `{"#tup": []}` as the value of a constructor without one. The elements of a
  set and the entries of a map are sorted, so one counterexample gives one
  text.

The encoding follows each variable's type in Quint's IR, so a map with one
string key, a variant, a record and a map on `1..n`, which TLA+ prints alike,
come out distinct. A variable whose type has no encoding here is refused at
translation. A state that holds a set the checker keeps unexpanded (`1.to(n)`,
`setOfMaps`, `tuples`) is enumerated, up to 100 000 elements per set; past
that, or for any value quint-check can't encode, the result is an `error`, never
a counterexample with a value guessed, and quint-check never writes
`#unserializable`. The trace has no `varTypes` in its `#meta`, so Apalache
can't read the file back. The conformance harness replays each
counterexample through Quint's simulator, which must write the same ITF and
reach each state with the model's own actions
([conformance/itf.ts](conformance/itf.ts)).

## The supported subset

Safety invariants over finite models: integers (within TLC's 32-bit range),
Booleans, strings, sets, maps (literals with literal keys, `get`, `set`,
`put`, `setBy`, `keys`, `mapBy`, `setOfMaps`), records (`{ a: 1 }`,
`r.a`, `r.with("a", v)`, `{ ...r, a: v }`, `fieldNames`, nested, and in
sets, maps and variants), tuples of two or more items (`(a, b)`, `Tup`,
`t._1`, `item`, `tuples`, unpacking as in `((a, b)) => a + b`, nested, and
in sets, maps, records and variants), sum types (variants) and `match`, `fold` as a
sum, `all`, `any`, `nondet … oneOf`, `if`, parameterized actions and
instances with constants. `src/translate.ts` lists
the operators (`SUPPORTED_OPCODES`); an operator joins it only with a
conformance case that passes.

Outside the subset, and refused: temporal properties, lists,
`Bool` and the other built-in sets, `then`, `powerset`, `ipow`,
`chooseSome`, a non-sum `fold`, uninstantiated constants, and `/` or `%`
on negative operands (Quint's sources disagree on their value,
quint-co/quint#2070). `get`, `set` or `setBy` on a key the map lacks, which
Quint leaves undefined, is `unsupported` where a state reaches it. So is
an init that reads a state variable, directly or through a definition, where
init evaluates the read: Quint's evaluators reject it (QNT502), and TLC
solves it as an equation. A read is refused when tla-ts evaluates it, so a
construct where tla-ts skips a read that Quint's evaluators would reach
could still pass; none is known. The conformance harness also requires
Quint's simulator to accept every model expected to pass or violate, which
catches such a case in the models it covers, not in general.
A record with no fields, which Quint's documentation doesn't define, and a
field name that can't name a field of a TLA+ record (a string that isn't an
identifier, such as `Rec("a b", 1)`, or a TLA+ reserved word, such as
`DOMAIN`) are refused at translation; Quint's official route rejects both too.
The empty tuple `()` outside a variant's payload, which Quint's documentation
writes `<<>>` and its official route `[tag |-> "UNIT"]`, a tuple of one item,
which the documentation doesn't define, and `tuples` of fewer than two sets,
which the official route rejects, are refused at translation.
Two names that would become one TLA+ name are refused at translation:
quint-check writes `::` as `_`, so `a::b_c` and `a_b::c`, or an instance's
`a::x` and a module's `a_x`, can't both be checked.

Of Quint's 77 public examples, 12 translate today, and 5 get a definitive
verdict with their authors' own invariants (4 passed after a complete search, 1
violated with a counterexample). The count, and what would extend it, is in
[conformance/public/README.md](conformance/public/README.md).

## Processes and temporary files

A check runs two child processes, one after the other: Quint's frontend, then
the checker, which runs tla-ts in a Worker thread. Each check works in its own
folder under the system's temporary directory, named `quint-check-run-<pid>-...`
after the process that made it.

- **When a check settles**, every process it started has exited and its folder
  is gone. That holds when it passes, fails, times out or is cancelled. A
  folder that can't be removed, for example because another program holds a
  file in it, is reported as a process warning with the code
  `QUINT_CHECK_CLEANUP`, never thrown.
- **Stopping** sends SIGTERM and, 2 seconds later, SIGKILL. On Linux and macOS
  it signals the child's whole process group, so nothing it started outlives
  it. On Windows the child is ended with TerminateProcess. Processes a Node
  child starts without `detached` end with it, through the job object libuv
  puts every Node process in; processes started with `detached` leave that job
  and don't. quint-check's own children start none.
- **The CLI** turns Ctrl-C (SIGINT) and SIGTERM into a cancel: the check stops
  every process it started, and `quint-check` exits with 130 or 143. On Linux and
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

tla-ts compiles its own JavaScript on first use, and quint-check keeps the
compiled code between checks. The Windows benchmark workflow
(`.github/workflows/bench-windows.yml`) times checks with the cache warm and
off on a hosted runner. In its run at the first commit, the warm cache took
178 to 315 ms off the median check of each of four models
([bench/results/ci](bench/results/ci/win32-x64-github-windows-2025-x64.md)). The cache holds code of
tla-ts only, never anything about a model or a result; a result is the same
with the cache off, empty, warm or corrupted (`tests/cache.test.ts`).

| | |
| --- | --- |
| Where | `QUINT_CHECK_CACHE_DIR`, else `%LOCALAPPDATA%\quint-check\cache` (Windows), `~/Library/Caches/quint-check` (macOS), `$XDG_CACHE_HOME/quint-check` or `~/.cache/quint-check` (Linux) |
| Layout | one folder per tla-ts version, and inside it per runtime, platform and architecture |
| Off | `QUINT_CHECK_CACHE=off`; also off when the folder can't be created or written |
| Clear | `npx quint-check cache clear`; `cache path` prints the folder |

## Dependencies

| Package | Version | Role | Notes |
| --- | --- | --- | --- |
| `@informalsystems/quint` | 0.33.1 | Quint's official frontend | Published by Quint's CI with a provenance attestation |
| `tla-ts` | 0.0.9 | The model checker | A stable release |

Both are pinned to exact versions, and the lockfile pins their content.

tla-ts 0.0.9 is the first stable release with `-continue`
([tla-ts#358](https://github.com/aidenybai/tla-ts/pull/358)), which the
conformance harness uses to explore a model's whole graph past its
violations; quint-check's own checks never set it. It was published to npm
with an SLSA provenance attestation, and `npm audit signatures` verifies it.

## Performance

[bench/](bench/README.md) times quint-check against TLC and `quint verify
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
