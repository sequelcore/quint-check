# Counterexamples

A violation comes with a counterexample: the shortest path the search found
from an initial state to a state that breaks the invariant. quint-check gives
it in two forms: an ITF document in the result, for tools, and a readable
trace in the summary, for people.

## As ITF

`violated.trace` (and the file `check --out-itf <file>` writes) is an ITF
document, the [Informal Trace Format](https://apalache-mc.org/docs/adr/015adr-trace.html)
that `quint run --out-itf` writes. Quint, the ITF Trace Viewer for VS Code,
Quint's trace explorer and itf-rs read it.

- `vars` lists the state variables by their full Quint names, as Quint's own
  ITF names them: `x` in the main module, `a::x` and `b::x` for two
  instances.
- Each state holds every variable. Its `#meta` gives its `index` and the
  `action` that reached it, `init` for the first state.
- Values are encoded as Quint's writer encodes them:

  | Value | ITF |
  | --- | --- |
  | integer | `{"#bigint": "-1"}` |
  | set | `{"#set": [...]}` |
  | map | `{"#map": [[key, value], ...]}` |
  | tuple | `{"#tup": [...]}` |
  | record | an object |
  | variant | `{"tag": "Busy", "value": ...}`, with `{"#tup": []}` as the value of a constructor without one |

  The elements of a set and the entries of a map are sorted, so one
  counterexample gives one text.

The encoding follows each variable's type in Quint's IR, so a map with one
string key, a variant, a record and a map on `1..n`, which TLA+ prints alike,
come out distinct. A state that holds a set the checker keeps unexpanded
(`1.to(n)`, `setOfMaps`, `tuples`) is enumerated, up to 100 000 elements per
set.

quint-check never guesses a value. A variable whose type has no encoding here
is refused at translation, with `unsupported`. A set past the limit, or any
value quint-check can't encode, makes the result an `error`. quint-check never
writes `#unserializable`. The trace has no `varTypes` in its `#meta`, so
Apalache can't read the file back.

The conformance harness replays each counterexample it produces through
Quint's simulator, which must write the same ITF and reach each state with
the model's own actions ([conformance/itf.ts](https://github.com/sequelcore/quint-check/blob/main/conformance/itf.ts)).

## In the summary

`quint-check check` prints the trace in Quint's syntax, before the verdict.
The first state is printed whole. Each later state shows only the variables
that step changed, or `no change`:

```text
trace (each state after the first shows only what changed):
  state 0, init
    lockFree = true
    state = Map("p1" -> Idle, "p2" -> Idle, "p3" -> Idle)
  state 1, request
    state = Map("p1" -> Waiting, "p2" -> Idle, "p3" -> Idle)
```

| Value | Printed as |
| --- | --- |
| integer, Boolean, string | `-1`, `true`, `"text"` |
| set | `Set(1, 2)`, `Set()` |
| map | `Map("a" -> true)`, `Map()` |
| tuple | `(1, "x")`, `()` |
| record | `{ a: 1, b: Set() }` |
| variant | `Some({ x: true })`, or `None` for a constructor without a value |

A changed map is printed whole. An object with exactly the fields `tag` and
`value` reads as a variant, as Quint's tools read ITF, so a record with only
those two fields does too. The whole states are in `--json` and in the
`--out-itf` file.
