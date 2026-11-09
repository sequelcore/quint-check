# What a result means

A check ends with one of five statuses. Only `passed` establishes that an
invariant holds, and only for the model, under the semantics of the
supported subset.

| Status | What happened | What it establishes |
| --- | --- | --- |
| `passed` | Every reachable state was explored, and each invariant holds in each one. | The invariants hold in every reachable state of the model. |
| `violated` | The search reached a state that breaks an invariant. | That state is reachable, and no shorter path reaches any violating state. Nothing about the other invariants. |
| `unsupported` | The model needs something outside the [subset](subset.md): a construct, found during translation, or an operation a reachable state needs. | Nothing. |
| `inconclusive` | The time limit ran out, or the model has no initial state. | Nothing. |
| `error` | A stage failed: Quint's frontend, the translation or the checker. | Nothing. A `translation` error is a quint-check defect. |

The fields each status carries are in [the TypeScript API](api.md#checkresult).

## A `passed` needs a complete search

quint-check reports `passed` only when tla-ts reports success with at least
one initial state, at least one distinct state, and no state left in the
queue. A search the time limit stops is `inconclusive`, never a pass, however
many states it explored.

Two limits remain:

- tla-ts's result doesn't say how many invariants it evaluated, so
  quint-check can't confirm that from the result itself. It refuses a check
  with no invariant, a blank one or `true` before it runs, since such a
  check would pass without checking anything. An invariant that is a
  tautology written another way isn't detected.
- Deadlock isn't checked, as `quint verify --backend=tlc` doesn't check it.
  Every result says so in `guarantee.deadlock`.

## Which invariant a violation names

`violated.invariant` is the first invariant, in the order you gave them, that
the first violating state the search found breaks. It isn't the first
invariant that fails anywhere in the model: when `["a", "b"]` is checked and
`b` breaks in an earlier state than `a`, the result names `b`. An entry with a
comma, such as `"x >= 0, x <= 5"`, is one invariant, named whole, as `quint
compile --invariant` reads it.

## Why a check refuses rather than guesses

Quint's own tools don't always agree. For `/` and `%` on negative numbers,
its simulators and `quint verify` truncate, while `quint verify
--backend=tlc` rounds down
([quint-co/quint#2070](https://github.com/quint-co/quint/issues/2070)). For
other operations, such as `get` on a key the map lacks, Quint leaves the
result undefined. Where the meaning isn't settled, quint-check returns
`unsupported` instead of picking one.

An operator joins the subset only after a
[conformance case](https://github.com/sequelcore/quint-check/blob/main/conformance/README.md)
shows that quint-check agrees with Quint's tools on it, so a `passed` never
rests on a guess.

The same rule covers what the search can't finish: a time limit, a missing
initial state or a failed stage is reported as what it is, with
`guarantee.scope` set to `partial` or `none`. A tool that forwards a result
forwards its caveats with it.

## What it runs on

quint-check runs Quint's own frontend (`@informalsystems/quint`, as `quint
compile --target json`), so a model is parsed, typechecked and flattened
exactly as Quint does it. It then
translates the subset to TLA+ and checks it with
[tla-ts](https://github.com/aidenybai/tla-ts), a TLA+ model checker written in
TypeScript, which is why no Java is needed. Both dependencies are pinned to
exact versions, and each result names them in `guarantee.frontend` and
`guarantee.checker`.

This is explicit-state checking: tla-ts enumerates every reachable state, so
a model must be finite. `quint verify`'s default backend, Apalache, checks
symbolically and to a bound; quint-check has no equivalent of that.
