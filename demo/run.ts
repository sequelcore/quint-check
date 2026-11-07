/**
 * bun demo/run.ts
 *
 * Checks the three demo models with quint-ts and prints each result. Needs
 * Bun and Node (Quint's frontend runs on Node); no Java. Exits non-zero if
 * a result isn't the one the demo expects.
 */
import { join } from "node:path";
import { check, type CheckResult, tools } from "../src/check.ts";

const dir = import.meta.dir;
const demos: { file: string; main: string; expect: CheckResult["status"]; what: string }[] = [
  { file: "mutex.qnt", main: "mutex", expect: "passed", what: "a correct model: three processes, one lock, at most one in the critical section" },
  { file: "mutex_bug.qnt", main: "mutex_bug", expect: "violated", what: "the same model with a deliberate bug: enter doesn't check the lock" },
  { file: "mutex_records.qnt", main: "mutex_records", expect: "unsupported", what: "the correct model with the lock as a record, outside quint-ts's subset" },
];

let unexpected = 0;
for (const d of demos) {
  const result = await check(join(dir, d.file), { main: d.main, invariants: ["inv"] });
  console.log(`\n${d.file}: ${d.what}`);
  console.log(`  result: ${result.status} (expected ${d.expect}); search scope: ${result.guarantee.scope}; deadlock: ${result.guarantee.deadlock}`);
  if (result.status === "passed") console.log(`  every one of ${result.states} reachable states satisfies inv`);
  if (result.status === "violated") {
    console.log("  counterexample:");
    for (const [k, step] of result.trace.entries()) {
      console.log(`    ${k + 1}. ${step.action}: ${Object.entries(step.state).map(([v, x]) => `${v} = ${x}`).join(", ")}`);
    }
  }
  if (result.status === "unsupported" || result.status === "inconclusive") console.log(`  why: ${result.reason}; nothing was proved`);
  if (result.status === "error") console.log(`  ${result.stage}: ${result.output.split("\n").slice(-3).join(" ")}`);
  if (result.status !== d.expect) unexpected += 1;
}
console.log(`\n${unexpected === 0 ? "every result is the expected one" : `${unexpected} unexpected result(s)`}; ` +
  `Quint ${tools.quintVersion} as the frontend, tla-ts ${tools.tlaTsVersion} as the checker`);
process.exit(unexpected === 0 ? 0 : 1);
