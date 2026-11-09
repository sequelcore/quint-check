# quint-check

Instructions for agents contributing to quint-check, a Java-free Quint model
checker built on Quint's frontend and tla-ts. Read [README.md](README.md)
for what a result means.

## Rules

- A result must never claim more than was checked. When a construct's
  meaning isn't confirmed, the result is `unsupported` or `inconclusive`,
  never `passed`.
- Change the conformance harness before the translator. An operator joins
  `SUPPORTED_OPCODES` only with a case in `conformance/operators.ts` (or a
  model in `conformance/models.ts`) that passes; `tests/coverage.test.ts`
  enforces it.
- No translation by regular expressions over Quint source. Translate the
  IR from `quint compile --target json`.
- Quint's simulators are not the only authority. A case's `semantics` comes
  from Quint's documentation; where the documentation and the evaluators
  disagree the case is `contested`, and quint-check refuses it.
- Don't present a disagreement between routes as an upstream bug unless its
  reproduction in `repro/` shows it and its README says why it's a defect
  and not undefined behavior.
- A cache is an optimization, never evidence. It may hold the checker's
  compiled code; it never holds or reuses a model's states or a result, and
  a result must be the same with it off.
- Keep this package independent of Tesota: no imports from it, no Tesota
  vocabulary in the API.

## Commands

- `bun install --frozen-lockfile`
- `bun run check`: types and tests.
- `bun run conformance`: the full harness (needs Java for the official
  route; `--no-official` skips it). Commit `conformance/MATRIX.md` and
  `conformance/results/<platform>-<arch>.json` with the change that produced them.
- `bun run bench`: timings under equivalent guarantees ([bench/README.md](bench/README.md)).
  Run it on a quiet machine, and don't optimize without a baseline from it.
- `git diff --check`

Dependencies are pinned to exact versions. A version bump reruns the
harness and commits its results in the same change.
