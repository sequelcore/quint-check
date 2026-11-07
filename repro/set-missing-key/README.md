# `set` with a key the map lacks

`setkey.qnt` sets key 2 of `Map(1 -> 0)`. Output: [setkey.output.txt](setkey.output.txt).

| Route | Result |
| --- | --- |
| `quint run --backend=typescript` | Runtime error QNT507, "Called 'set' with a non-existing key" |
| `quint run --backend=rust` | The same |
| `quint verify --backend=tlc` | No violation |
| `quint verify` (Apalache) | No violation |

## Not a correctness bug

`quint/src/builtin.qnt:348` says: "If `k` is not a key in `m`, this
operator has undefined behavior." Any result is allowed, so the verifiers'
pass isn't a false pass. The TLA+ translation, `[m EXCEPT ![2] = 5]`,
returns `m` unchanged, which explains it.

What the case shows is that the same model is rejected by the simulators and
accepted by the verifiers, with no warning from either. A model that relies
on this passes verification while its simulation fails.

## Possible proposal

That every backend reject an operation outside its domain, as the
simulators do. It's a design proposal for quint-co/quint, not a defect
report, and the same question applies to `get` and `setBy`. quint-ts already
does this: it reports `unsupported` at the state that reaches the operation.
