# A Map literal with a repeated key

`repeated.qnt` reads key 1 of `Map(1 -> 0, 1 -> 2)`. Output: [repeated.output.txt](repeated.output.txt).

| Route | Value |
| --- | --- |
| `quint run --backend=typescript` | 2 |
| `quint run --backend=rust` | 2 |
| `quint verify --backend=tlc` | 0 (violation) |
| `quint verify` (Apalache) | 0 (violation) |

The simulators keep the last pair; both verifiers keep the first. Quint's
documentation gives no rule for a repeated key, so it's unclear whether this
is a defect or unspecified behavior. At most it's a documentation question
for quint-co/quint. quint-ts refuses a Map literal with a repeated key.
