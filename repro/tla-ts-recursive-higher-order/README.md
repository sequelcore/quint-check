# tla-ts: a recursive operator with an operator parameter

`Recursive.tla` declares `RECURSIVE Fold(_, _, _)` and defines
`Fold(Op(_, _), v, S)`, which calls itself passing `Op` on. It is the shape of
`ApaFoldSet` in Apalache's `Apalache.tla`. `NonRecursive.tla` is the control:
the same operator parameter, no recursion. Output: [output.txt](output.txt),
from `./run.sh`.

| Module | TLC 2.19 (tla2tools.jar) | tla-ts 0.0.8-dev.8067c48 |
| --- | --- | --- |
| `Recursive.tla` | Checked: no error, `Sum` holds (x = 6) | Rejected at parsing: "The operator Op requires 2 arguments." (exit 150) |
| `NonRecursive.tla` | Checked: no error | Checked: no error |

tla-ts accepts operator parameters, but not one passed on in a recursive
call, where TLC accepts it. A compatibility gap with TLC, for
aidenybai/tla-ts. Its effect here: tla-ts can't load Apalache's
`Apalache.tla`, so it can't run Apalache's translation of a Quint `fold`.
quint-ts doesn't depend on it (it emits a recursive operator per fold, with
no operator parameter). Reported as [aidenybai/tla-ts#363](https://github.com/aidenybai/tla-ts/issues/363) on 2026-11-07.
