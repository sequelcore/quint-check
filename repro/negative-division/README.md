# Negative division

`div.qnt` computes `(-7) / 2`; `mod.qnt` computes `(-7) % 2`. Output:
[div.output.txt](div.output.txt), [mod.output.txt](mod.output.txt), from
`../run-quint.sh div.qnt` and `../run-quint.sh mod.qnt`.

| Route | `(-7) / 2` | `(-7) % 2` |
| --- | --- | --- |
| `quint run --backend=typescript` | -3 | -1 |
| `quint run --backend=rust` | -3 | -1 |
| `quint verify` (Apalache, symbolic) | -3 (invariant holds) | -1 (invariant holds) |
| `quint verify --backend=tlc` | **-4** (violation) | **1** (violation) |

The same model passes `quint verify` and fails `quint verify --backend=tlc`.

## Why it's a defect

- Two of Quint's verification backends give opposite verdicts on one model,
  and the simulators side with one of them.
- The likely cause. From the code: Apalache's Quint converter
  (`tla-io/src/main/scala/at/forsyte/apalache/io/quint/Quint.scala`,
  apalache-mc/apalache at 9a13950e) maps `idiv` to `\div` and `imod` to `%`,
  and the TLC backend (`quint/src/tlc.ts`) runs Apalache's TLA+ output under
  TLC. From the outputs above: Apalache's own checker reads `\div` and `%`
  as truncating, TLC as flooring. I haven't read Apalache's encoding of
  `\div` to confirm the first.
- Quint's sources disagree on which is right. The language reference
  (`docs/content/docs/lang.md:1401`) says `/` is "integer division, lik m
  \div n in TLA+" and `%` is "like m % n in TLA+", which floor. The integers
  lesson (`docs/content/docs/lessons/integers.md:242`) says the operators
  "compute the integer part", which reads as truncation. Both evaluators
  truncate (`quint/src/runtime/impl/builtins.ts:377`,
  `evaluator/src/builtins.rs:371`).

`7 % (-2)` also differs: the simulators give 1, TLC's `%` refuses a negative
divisor (see the `mod-neg-divisor` row of the conformance matrix).

## Owner

quint-co/quint: its TLC backend (`quint/src/tlc.ts`) and its documentation.
The converter in Apalache follows the language reference and is maintained
by Quint's maintainers; whether the fix belongs in the converter, in a
TLC-specific translation, or in the evaluators is their decision.

## What a report should ask

Which semantics `/` and `%` have for negative operands, and that every
backend follow it. Reported as [quint-co/quint#2070](https://github.com/quint-co/quint/issues/2070) on 2026-11-07.
