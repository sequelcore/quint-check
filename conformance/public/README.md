# Public Quint models

Models from Quint's own examples, copied unchanged from
[quint-co/quint](https://github.com/quint-co/quint) at commit
`07d7a1a69c2093b5bc656caf3b5dfefa0d766cd0`, under the Apache License 2.0
(see the repository's `NOTICE`), in the same folders where upstream keeps
them when one imports another (`games/secret-santa/secret_santa.qnt` imports
`spells/basicSpells.qnt`). Two files are ours, and import a model unchanged
to add invariants to it: `booleans_check.qnt`, because `booleans.qnt`
declares none, and `play_rock_paper_scissors_check.qnt`, to plant a
violation.

They test quint-check on specifications it didn't write, in four groups
([models.ts](../models.ts) and [public.ts](../public.ts)):

| Group | Expected | Models |
| --- | --- | --- |
| Supported, with the authors' own invariants | The whole graph compared across routes, as for the other models | `play_rock_paper_scissors.qnt` (`winInv`, passed), `ewd426.qnt` (`tokenInv`, passed, in both of its modules), `ewd426_3.qnt` (`tokenInv`, passed), `ewd426_4.qnt` (`tokenInv`, passed), `games/secret-santa/secret_santa.qnt` (`inv`, violated, as in Quint's own route), `DiningPhilosophers5.qnt` (`TypeOk` and `Safety`, passed), `ewd840.qnt` (`IndInv`, passed; `TokenAlwaysBlack`, a non-property its authors list, violated), `prisoners.qnt` (`safetyInv`, passed) |
| Supported, with an invariant we added | The same | `booleans.qnt` and `tuples.qnt` (each with one invariant that holds, one that breaks), and `play_rock_paper_scissors.qnt` (a draw is reachable) |
| Partially supported | Translated, but no complete verdict: `inconclusive`, never `passed` | `instances.qnt`, whose counters grow without bound |
| Refused | `unsupported` at translation, naming the construct | `weakFairness.qnt` (`leadsTo`), `coin.qnt` (`ipow`), `two_phase_commit.qnt` (`then`), `tictactoe.qnt` (`eventually`), `BinSearch.qnt` (`ipow`), `generate.qnt` (`apalache::generate`), `counters.qnt` (`then`), `bakery.qnt` (`Nat`) |

Every model here is accepted by Quint's frontend. A refusal is a limit of
quint-check's subset, not a defect in the model or in Quint.

## All of Quint's examples

All 77 `.qnt` files in Quint's `examples/` went through quint-check's
translation, with the last module of each file as the main module, then the
translated ones were checked with their authors' invariants:

| | Before variants | With variants | With map operations | With records | With tuples | With `Bool` (now) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Translated | 2 | 3 | 6 | 9 | 12 | **14** |
| … a definitive verdict with the authors' own invariant | 0 | 1 | 4 | 5 | 5 | **7**: 6 `passed` after a complete search, 1 `violated` with a counterexample |
| … no invariant of the authors to check | 1 | 1 | 1 (`booleans.qnt`, checked with invariants we added) | 3 | 5 | 5 (`booleans.qnt`, `records.qnt`, `kettle.qnt`, `DiningPhilosophers5.qnt`, `tuples.qnt`) |
| … translated but `inconclusive` | 1 | 1 | 1 | 1 | 2 | 2 (`instances.qnt`, unbounded; `teaching.qnt`, not finished in the survey's 30 s) |
| Refused by quint-check | 49 | 48 | 44 | 41 | 38 | 36 |
| Rejected by Quint's own frontend with the module chosen | 1 | 1 | 1 | 1 | 1 | 1 |
| Without both `init` and `step` (libraries and tests) | 25 | 25 | 26 | 26 | 26 | 26 |

The "now" column comes from [SURVEY.md](SURVEY.md), which
[survey.ts](../survey.ts) generates from a Quint checkout at the commit above,
one row per file; the earlier columns were counted by hand:

```sh
bun run survey -- --examples <Quint checkout>
```

The hand count of the "now" column had `SimpleAuction.qnt` among the refused
(45 refused, 25 without `init` or `step`). It has an `init` but no `step`, so
Quint's frontend rejects it before translation, and the script counts it as
without `init` or `step`. The script's
invariants are the zero-parameter definitions named `inv`, `*Inv` or `*_inv`
in the file, each checked on its own; for `ewd426.qnt` it checks the last
module, `broken_ewd426`.

Each verdict matches `quint verify --backend=tlc` on the same model and
invariant: 117,649 states for `ewd426`, 16 for its `broken_ewd426` module,
729 for `ewd426_3`, 1,024 for `ewd426_4`, 19 for `play_rock_paper_scissors`, and a 3-state
counterexample for `secret_santa`. Records brought `ewd426_4.qnt` to a
verdict and made `records.qnt` and `kettle.qnt` translate; the other 19
refused models that use records also need another construct, now the
first reason SURVEY.md gives for them. The map operations reached 3 of the 5
models they were expected to unlock; `ewd840.qnt` and `prisoners.qnt` also
need `Bool`, the set of Booleans.

Tuples made `DiningPhilosophers5.qnt`, `tuples.qnt` and `teaching.qnt`
translate, and brought no new definitive verdict to the survey: none of the
three has an invariant named as the survey looks for one.
`DiningPhilosophers5.qnt` has its authors' `TypeOk` and `Safety`, which
[models.ts](../models.ts) checks: passed, 352 states, as in Quint's own
route. `teaching.qnt`'s `IndInv` didn't finish within the survey's 30
seconds. The other refused models that used tuples now stop at another
construct: `bakery.qnt` at `Nat`, `tictactoe.qnt` at `eventually`,
`mutex.qnt` at `Int`, and both ICS-20 models at `List`.

Counting every construct each refused model uses, not only the first, the
next additions with the most models fully inside the subset are `Bool`
(`ewd840.qnt`, `prisoners.qnt`) and `ipow` (`imports.qnt`, `integers.qnt`) at the time of the tuples survey. Being inside the subset is
necessary, not sufficient: a model must also be finite and declare an
invariant to get a complete verdict.

`Bool` brought `ewd840.qnt` and `prisoners.qnt` to verdicts with their authors' invariants: `IndInv` and
`Inv` passed in 302 states, and `countInv` and `safetyInv` in 70. `ewd840.qnt`'s `TokenAlwaysBlack`, which
its authors list as a non-property, is violated, as in Quint's own route
([models.ts](../models.ts)). The next addition with the most models fully inside the subset is `ipow`
(`imports.qnt`, `integers.qnt`).

Lists brought no example to a verdict. The eight that used them now stop at
another construct: `BinSearch.qnt` at `ipow`, `lists.qnt` at `foldl`,
`two_layered_cache.qnt` at `eventually`, `lottery.qnt` at `then`,
`bank.qnt` at `assert`, `utxo.qnt` at an operator with a parameter defined
inside a value, and `denomTrace.qnt` and `ics20.qnt` at an operator argument
that isn't a lambda.

The other list operators brought no example to a verdict either.
`lists.qnt`, `option.qnt` and `vote.qnt`, which stopped at `foldl` or
`replaceAt`, now stop at an operator passed as an argument to another.
