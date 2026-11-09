# TypeScript API

The package exports one function, `check`, and the types `CheckOptions`,
`CheckResult`, `Guarantee`, `ItfTrace`, `ItfState` and `ItfValue`. Anything
else in the package is internal.

```ts
import { check, type CheckResult } from "@sequelcore/quint-check";
```

## `check()`

Checks each invariant in every reachable state of a model, and resolves with
what the search established.

```ts
function check(file: string, options: CheckOptions): Promise<CheckResult>;
```

`file` is the path of the `.qnt` file. The check runs Quint's frontend and the
checker in child processes; see [Processes, files and the cache](operations.md).

### `CheckOptions`

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `invariants` | `readonly [string, ...string[]]` | required | Each a definition name or an expression of the model, as `quint compile --invariant` takes it. Each is checked and named separately. |
| `main` | `string` | Quint's choice, from the file name | The module to check. |
| `init` | `string` | `"init"` | The initializer action. |
| `step` | `string` | `"step"` | The step action. |
| `timeoutMs` | `number` | `60000` | The time limit for the whole check, Quint's frontend included: a whole number of milliseconds from 1 to 2147483647. |
| `signal` | `AbortSignal` | none | Aborting it stops the check. |

### Rejections

A failed check resolves with an `error` result rather than rejecting. `check`
rejects:

- with a `TypeError`, before anything runs, when `invariants` is empty or
  holds a blank entry or `true`, since such a check would pass without
  checking anything;
- with a `RangeError`, before anything runs, when `timeoutMs` isn't a whole
  number from 1 to 2147483647;
- with `signal.reason` when `signal` aborts, once every process the check
  started is gone;
- with the file system's error when quint-check can't create its temporary
  folder or write in it, such as `EACCES` or `ENOSPC`.

```ts
const controller = new AbortController();
const running = check("spec.qnt", { invariants: ["inv"], signal: controller.signal });
controller.abort(new Error("cancelled by the caller"));
await running.catch((reason) => console.log(reason.message)); // cancelled by the caller
```

## `CheckResult`

A union on `status`. Every variant carries [`guarantee`](#guarantee).

| `status` | Fields | `guarantee.scope` |
| --- | --- | --- |
| `"passed"` | `search` | `"complete"` |
| `"violated"` | `invariant: string`, `trace: ItfTrace`, `search` | `"partial"` |
| `"unsupported"` | `reason: string`, `where: "translation" \| "reached-state"` | `"none"` (translation) or `"partial"` (reached state) |
| `"inconclusive"` | `reason: "timeout" \| "no-initial-state"` | `"none"` before the search, `"partial"` during it |
| `"error"` | `stage: "frontend" \| "translation" \| "checker"`, `output: string` | `"none"` or `"partial"` |

- **`invariant`** is the entry of `options.invariants`, as given, that the
  last state of `trace` breaks; [which one it names](results.md#which-invariant-a-violation-names).
- **`trace`** is the counterexample as an ITF document; see
  [Counterexamples](counterexamples.md).
- **`reason`**, on `unsupported`, names the construct or operation, such as
  `operator powerset`.
- **`output`**, on `error`, is what the failing stage printed or why it
  couldn't run.

```ts
const result = await check("spec.qnt", { main: "spec", invariants: ["inv", "balance >= 0"] });
switch (result.status) {
  case "passed": console.log(`${result.search.distinctStates} states, all invariants hold`); break;
  case "violated": console.log(`${result.invariant} breaks after ${result.trace.states.length} states`); break;
  case "inconclusive": if (result.reason === "timeout") console.log("retry with a larger timeoutMs"); break;
  case "unsupported": console.log(`outside the subset: ${result.reason}`); break;
  case "error": console.error(`${result.stage}: ${result.output}`); break;
}
```

### `search`

The counts tla-ts reports when its search ends, on `passed` and `violated`:

| Field | Meaning |
| --- | --- |
| `initialStates` | Distinct initial states. |
| `distinctStates` | Distinct states found, initial ones included. |
| `queuedStates` | States found but not yet explored. Always 0 on `passed`. |

On `violated`, these are the counts when the search stopped at the
violation. A search stopped by the time limit has no counts.

## `Guarantee`

What a check covered. Every result carries it, so a forwarded result keeps
its caveats.

| Field | Value |
| --- | --- |
| `method` | `"explicit-state"` |
| `property` | `"safety-invariant"` |
| `scope` | `"complete"` only when every reachable state was explored; else `"partial"` or `"none"`. The type narrows it by status. |
| `deadlock` | `"not-checked"`, as `quint verify --backend=tlc` doesn't check it |
| `frontend` | `{ name: "quint", version }` |
| `checker` | `{ name: "tla-ts", version }` |
