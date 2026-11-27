# Veil and colliding `int` states

`fp.qnt` goes from `x = 0` to `x = 2^62`, with the invariant `x == 0`.
Output: [fp.output.txt](fp.output.txt), from `./run-veil.sh` with Quint
0.35.0 and Node 24.15.0 on Ubuntu 24.04 (WSL2). Quint refuses the Veil
backend on Windows, so this case has no Windows run.

| Route | Result |
| --- | --- |
| `quint run --backend=typescript` | violation at `x = 4611686018427387904` |
| `quint run --backend=rust` | violation at `x = 4611686018427387904` |
| `quint verify --backend=veil` | **`[ok]` after 1 state**, exit 0 |
| `quint verify --backend=veil --symbolic --max-steps=1` | violation at `x = 4611686018427387904` |

The script also runs twelve pairs `a -> b`, each a model that sets `x` to `a`,
then to `b`, with the invariant `x == a`. Veil answers `[ok]` for `0 -> 2^62`,
`0 -> 2^63`, `0 -> 2^64`, `1 -> 2^62 + 1`, `7 -> 2^62 + 7` and
`-1 -> -2^62 - 1`, and finds the violation for `0 -> 2^61`, `0 -> 2^62 - 1`,
`0 -> 2^62 + 1`, `0 -> 2^63 - 1`, `1 -> 2^63` and `-2 -> -2^62 - 1`.

## Why it's a defect

- Quint's `int` is unbounded: the integers lesson of its documentation says
  integers "cannot overflow, as they are big integers". Both simulators reach
  `x = 2^62` and report the violation; the Veil backend reports `[ok]`.
- Veil reaches the state and drops it. With `--verbosity=4`, `step_` has
  `statesGenerated: 1` and `distinctStates: 0`, and the search ends with
  `explored_all_reachable_states`. The bounded symbolic mode, which doesn't
  deduplicate states, finds the violation in the same file, so the
  transition and the invariant reach Veil intact.
- The likely cause, from the sources: Lean 4.35.0 hashes an `Int` as
  `UInt64.ofNat (2 * n)` for `n ≥ 0` and `UInt64.ofNat (2 * n + 1)` for
  `Int.negSucc n` (`Init/Data/Hashable.lean`); Veil's default fingerprint
  clears the top bit of a state's hash (`StateFingerprint.ofHashNat` in
  `Veil/Core/Tools/ModelChecker/Concrete/Core.lean`, Veil at `57447722`); and
  Quint emits `#model_check compiled {} {}` (`quint/src/veil.ts`), which keeps
  that default. A state that is one non-negative `int` then gets the
  fingerprint `2 * (x mod 2^62)`, which predicts every row above. The
  negative pairs follow the odd branch the same way.
- Quint's announcement states Veil's guarantee "as long as no two states
  share a fingerprint", so this doesn't contradict Veil's theorem. It is a
  defect in what the command reports: the condition fails deterministically
  for an ordinary model, and the result is `[ok]` with no warning.

## Owner

quint-co/quint: the Veil backend chooses the fingerprint and reports the
result. Whether the fix compares full states, changes the fingerprint, or
qualifies the result is its maintainers' decision.

## What a report should ask

That `quint verify --backend veil` not report `[ok]` for `fp.qnt`. Not
reported yet.
