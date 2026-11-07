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

They test quint-ts on specifications it didn't write, in four groups
([models.ts](../models.ts) and [public.ts](../public.ts)):

| Group | Expected | Models |
| --- | --- | --- |
| Supported, with the authors' own invariants | The whole graph compared across routes, as for the other models | `play_rock_paper_scissors.qnt` (`winInv`, passed), `ewd426.qnt` (`tokenInv`, passed, in both of its modules), `ewd426_3.qnt` (`tokenInv`, passed), `games/secret-santa/secret_santa.qnt` (`inv`, violated, as in Quint's own route) |
| Supported, with an invariant we added | The same | `booleans.qnt` (one invariant that holds, one that breaks), and `play_rock_paper_scissors.qnt` (a draw is reachable) |
| Partially supported | Translated, but no complete verdict: `inconclusive`, never `passed` | `instances.qnt`, whose counters grow without bound |
| Refused | `unsupported` at translation, naming the construct | `weakFairness.qnt` (`leadsTo`), `coin.qnt` (`ipow`), `ewd840.qnt` and `prisoners.qnt` (`Bool`), `two_phase_commit.qnt` (`then`), `tictactoe.qnt` (`Tup`), `BinSearch.qnt` (`List`), `generate.qnt` (`apalache::generate`), `counters.qnt` (`then`), `bakery.qnt` (`item`) |

Every model here is accepted by Quint's frontend. A refusal is a limit of
quint-ts's subset, not a defect in the model or in Quint.

## All of Quint's examples

All 77 `.qnt` files in Quint's `examples/` went through quint-ts's
translation, with the last module of each file as the main module, then the
translated ones were checked with their authors' invariants:

| | Before variants | With variants | With map operations (now) |
| --- | ---: | ---: | ---: |
| Translated | 2 | 3 | **6** |
| … a definitive verdict with the authors' own invariant | 0 | 1 | **4**: 3 `passed` after a complete search, 1 `violated` with a counterexample |
| … a complete verdict only with an invariant we added | 1 | 1 | 1 (`booleans.qnt`) |
| … translated but `inconclusive` (unbounded) | 1 | 1 | 1 (`instances.qnt`) |
| Refused by quint-ts | 49 | 48 | 44 |
| Rejected by Quint's own frontend with the module chosen | 1 | 1 | 1 |
| Without both `init` and `step` (libraries and tests) | 25 | 25 | 26 |

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
729 for `ewd426_3`, 19 for `play_rock_paper_scissors`, and a 3-state
counterexample for `secret_santa`. The map operations reached 3 of the 5
models they were expected to unlock; `ewd840.qnt` and `prisoners.qnt` also
need `Bool`, the set of Booleans.

Counting every construct each refused model uses, not only the first, the
next additions with the most models fully inside the subset are `Bool`
(`ewd840.qnt`, `prisoners.qnt`), records (`records.qnt`, `kettle.qnt`) and
`ipow` (`imports.qnt`, `integers.qnt`). Being inside the subset is
necessary, not sufficient: a model must also be finite and declare an
invariant to get a complete verdict.
