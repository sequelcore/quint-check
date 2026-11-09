# The supported subset

quint-check checks safety invariants of finite models written in a subset of
Quint. A model that needs anything else gets `unsupported`, with the
construct or operation named, never a pass.

`src/translate.ts` lists the supported operators in `SUPPORTED_OPCODES`. An
operator joins it only with a [conformance case](https://github.com/sequelcore/quint-check/blob/main/conformance/README.md)
that passes, and `tests/coverage.test.ts` enforces that.

## Supported

| Kind | Constructs |
| --- | --- |
| Values | integers within the checker's 32-bit range, with `+`, `-`, `*`, `/`, `%` and comparisons; Booleans, with `and`, `or`, `not`, `implies`, `iff`, and `Bool`, the set of both; strings; `==` and `!=` |
| Sets | literals, `in`, `contains`, `union`, `intersect`, `exclude`, `subseteq`, `size`, `to`, `exists`, `forall`, `filter`, `map` |
| Maps | literals with literal keys, `get`, `set`, `put`, `setBy`, `keys`, `mapBy`, `setOfMaps` |
| Records | `{ a: 1 }`, `r.a`, `r.with("a", v)`, `{ ...r, a: v }`, `fieldNames`, nested, and in sets, maps and variants |
| Tuples | two or more items: `(a, b)`, `Tup`, `t._1`, `item`, `tuples`, unpacking as in `((a, b)) => a + b`, nested, and in sets, maps, records and variants |
| Lists | `[1, 2]` and `List(1, 2)`, `append`, `concat`, `head`, `tail`, `length`, `l[i]` and `nth`, `indices`, nested, and in sets, maps and records |
| Sum types | variants and `match` |
| Other | `fold` over a set as a sum (`acc + f(x)`), `all`, `any`, `nondet … oneOf`, `if`, parameterized actions, and instances with constants |

## Refused at translation

These make `check` return `unsupported` with `where: "translation"`, before
any state is explored.

| Construct | Why |
| --- | --- |
| Temporal properties | Only safety invariants are checked. |
| `replaceAt`, `slice`, `range`, `select`, `foldl` and the other list operators, `Int` and `Nat`, `then`, `powerset`, `ipow`, `chooseSome` | Not in the subset yet. |
| A `fold` whose step isn't `acc + f(x)` | Quint leaves a fold undefined unless its operator is associative and commutative; a sum is both. |
| Uninstantiated constants | Instances with constants are checked; give the constants values in an instance. |
| A record with no fields | Quint's documentation doesn't define it, and Quint's official route rejects it. |
| A field name that can't name a TLA+ record field: a string that isn't an identifier, such as `Rec("a b", 1)`, or a TLA+ reserved word, such as `DOMAIN` | Quint's official route rejects it too. |
| The empty tuple `()` outside a variant's payload | Quint's documentation writes it `<<>>` and its official route `[tag \|-> "UNIT"]`, so a state would print two ways. |
| A tuple of one item | Quint's documentation doesn't define it. |
| `tuples` of fewer than two sets | Quint's official route rejects it. |
| Two Quint names that would become one TLA+ name, such as `a::b_c` and `a_b::c`, or an instance's `a::x` and a module's `a_x` | quint-check writes `::` as `_`, so both can't be checked. |

## Refused where a state reaches them

These make `check` return `unsupported` with `where: "reached-state"`, when a
reachable state needs them. A model that never reaches them is checked.

| Operation | Why |
| --- | --- |
| `/` and `%` on negative operands | Quint's sources disagree on their value ([quint-co/quint#2070](https://github.com/quint-co/quint/issues/2070)). |
| `get`, `set` or `setBy` on a key the map lacks | Quint leaves the result undefined. |
| `head` or `tail` of an empty list, and `nth` outside `0` to `length() - 1` | Quint leaves the result undefined. |
| A computed integer outside the checker's 32-bit range | Quint's integers are unbounded; the checker's aren't, and it stops rather than wrap. |
| An init that reads a state variable, directly or through a definition, where init evaluates the read | Quint's evaluators reject it (QNT502), and TLC solves it as an equation. |

An integer *literal* outside the 32-bit range is the exception: the checker
refuses it while reading the translation, so a model that holds one gets
`unsupported` before any state is explored, even in a branch the search would
never take. The result still says `where: "reached-state"`.

A read is refused when tla-ts evaluates it, so a construct where tla-ts skips
a read that Quint's evaluators would reach could still pass; none is known.
The conformance harness also requires Quint's simulator to accept every
model expected to pass or violate, which catches such a case in the models
it covers, not in general.

## Quint's own examples

Of the 77 `.qnt` files in Quint's `examples/`, 14 translate today, and 7 get
a definitive verdict with their authors' own invariants: 6 passed after a
complete search, and 1 violated with a counterexample. The counts, and what
would extend them, are in [conformance/public/README.md](https://github.com/sequelcore/quint-check/blob/main/conformance/public/README.md).
