#!/usr/bin/env node
/**
 * quint-ts check <file.qnt> --invariant inv [--invariant inv2] [--main M] [--init I] [--step S] [--timeout ms]
 * quint-ts translate <file.qnt> [--invariant inv] [--main M] [--init I] [--step S]
 * quint-ts cache path|clear
 * `check` prints the result as JSON and exits 0 only when the check passed.
 * A usage error prints a message and exits 2.
 */
import { parseArgs } from "node:util";
import { cacheRoot, clearCaches } from "./cache.js";
import { check, invariantProblem, translateFile } from "./check.js";

const USAGE = "usage: quint-ts check <file.qnt> --invariant <inv> [--invariant <inv>...] [--main M] [--init I] [--step S] [--timeout ms]\n" +
  "       quint-ts translate <file.qnt> [--invariant <inv>...] [--main M] [--init I] [--step S]\n" +
  "       quint-ts cache path|clear";

function usage(problem: string): never {
  console.error(`quint-ts: ${problem}\n${USAGE}`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "cache") {
  if (rest.length !== 1 || (rest[0] !== "path" && rest[0] !== "clear")) usage("cache takes one argument: path or clear");
  if (rest[0] === "path") console.log(cacheRoot());
  else for (const removed of clearCaches()) console.log(`removed ${removed}`);
  process.exit(0);
}
if (command !== "check" && command !== "translate") usage(command === undefined ? "no command given" : `unknown command ${command}`);

let parsed;
try {
  parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      main: { type: "string" },
      init: { type: "string" },
      step: { type: "string" },
      // Each value goes to Quint whole: a comma inside it is Quint's own syntax, as in `quint compile --invariant`.
      invariant: { type: "string", multiple: true },
      timeout: { type: "string" },
    },
  });
} catch (err) {
  // node:util reports an unknown option, or one missing its value, with a code starting ERR_PARSE_ARGS.
  if (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS")) usage(err.message.split(". ")[0] ?? err.message);
  throw err;
}
const { values, positionals } = parsed;
if (positionals.length !== 1) usage(positionals.length === 0 ? "no model file given" : `unexpected argument ${positionals.slice(1).join(" ")}`);
const file = positionals[0] ?? "";
const invariants = values.invariant ?? [];
const selected = {
  ...values.main === undefined ? {} : { main: values.main },
  ...values.init === undefined ? {} : { init: values.init },
  ...values.step === undefined ? {} : { step: values.step },
};

if (command === "translate") {
  if (values.timeout !== undefined) usage("--timeout applies to check only");
  if (invariants.length > 0) {
    const problem = invariantProblem(invariants);
    if (problem !== undefined) usage(problem);
  }
  const t = translateFile(file, { ...selected, invariants });
  if (t.kind !== "translated") {
    console.log(JSON.stringify(t, null, 2));
    process.exit(1);
  }
  console.log(`${t.translation.tla}\n\n\\* Q.cfg\n\\* ${t.translation.cfg.replaceAll("\n", "\n\\* ")}`);
  process.exit(0);
}

const problem = invariantProblem(invariants);
const [first, ...others] = invariants;
if (problem !== undefined || first === undefined) usage(`${problem ?? "a check needs at least one invariant"} (--invariant)`);
// The largest delay a Node timer holds: past it a timer fires after 1 ms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const timeout = values.timeout;
const timeoutMs = timeout === undefined ? undefined : Number(timeout);
if (timeout !== undefined && (!/^[1-9]\d*$/.test(timeout) || !Number.isSafeInteger(timeoutMs) || (timeoutMs ?? 0) > MAX_TIMEOUT_MS)) {
  const shown = timeout.length > 24 ? `${timeout.slice(0, 24)}… (${timeout.length} characters)` : JSON.stringify(timeout);
  usage(`--timeout takes a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, not ${shown}`);
}
const result = check(file, {
  ...selected,
  invariants: [first, ...others],
  ...timeoutMs === undefined ? {} : { timeoutMs },
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "passed" ? 0 : 1);
