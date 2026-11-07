# Reproductions

Minimal cases where Quint's routes disagree, each with the commands that
produce its output and the output captured with Quint 0.33.1, Apalache
0.62.4 (Java 25) and tla-ts 0.0.8-dev.8067c48 on Ubuntu 24.04 (WSL2) with
Node 24.15.0, run from a checkout in `/tmp`. The same commands gave the same
results on Windows 11 x64, as the upstream reports show.
`run-quint.sh <file.qnt>` reruns a Quint case: both simulators,
`quint verify --backend=tlc` and `quint verify` (Apalache).

| Folder | What disagrees | Defect? | Owner | Report |
| --- | --- | --- | --- | --- |
| [negative-division](negative-division/) | `(-7) / 2` and `(-7) % 2`: -3 and -1 in both simulators and in `quint verify` (Apalache); -4 and 1 in `quint verify --backend=tlc` | Yes: two of Quint's own verification backends give opposite verdicts on the same model | quint-co/quint | [quint-co/quint#2070](https://github.com/quint-co/quint/issues/2070), 2026-11-07 |
| [set-missing-key](set-missing-key/) | `m.set(k, v)` with `k` not in `m`: both simulators fail with QNT507; both verify backends pass | No: the documentation leaves it undefined. Inconsistent diagnostics | quint-co/quint | Only as a proposal to reject it in every backend |
| [fold-order](fold-order/) | A fold whose operator isn't commutative: 123 in the TypeScript simulator, 213 in the Rust one | No: undefined by the documentation | — | None |
| [map-repeated-key](map-repeated-key/) | `Map(1 -> 0, 1 -> 2).get(1)`: 2 in both simulators, 0 in both verify backends | Unclear: the documentation gives no rule | quint-co/quint | A documentation question at most |
| [tla-ts-recursive-higher-order](tla-ts-recursive-higher-order/) | A `RECURSIVE` operator with an operator parameter: TLC 2.19 checks it, tla-ts rejects it at parsing | Yes: a compatibility gap with TLC | aidenybai/tla-ts | [aidenybai/tla-ts#363](https://github.com/aidenybai/tla-ts/issues/363), 2026-11-07 |

The other three stay as conformance cases and open semantic questions, not reported bugs.
