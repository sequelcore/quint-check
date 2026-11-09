# A fold that depends on order

`fold.qnt` folds `Set(1, 2, 3)` with `acc * 10 + i`. Output: [fold.output.txt](fold.output.txt).

| Route | Value |
| --- | --- |
| `quint run --backend=typescript` | 123 |
| `quint run --backend=rust` | 213 |
| `quint verify --backend=tlc` | 123 (invariant holds) |
| `quint verify` (Apalache) | 123 (invariant holds) |

`quint/src/builtin.qnt:182`: "The order in which the elements are combined
is unspecified, so the operator must be associative and commutative or else
it has undefined behavior." Every result is allowed; this isn't a bug.

It does show that a model can pass in one simulator and fail in the other,
so neither simulator can serve as the reference for such a fold. quint-check
translates a fold only when it is a sum (`acc + f(x)`), and refuses the rest.
