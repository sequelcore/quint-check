#!/usr/bin/env node
/**
 * quint-ts check <file.qnt> --invariant <expr> [--invariant <expr>...] [--main <module>] [--init <action>] [--step <action>] [--timeout-ms <ms>] [--out-itf <file>] [--json]
 * quint-ts translate <file.qnt> [--invariant <expr>...] [--main <module>] [--init <action>] [--step <action>]
 * quint-ts cache path|clear
 * quint-ts --help | --version        quint-ts <command> --help
 * `check` prints a summary, or with --json the result as JSON. Exit codes: 0 passed, 20 violated, 21 unsupported, 22 inconclusive,
 * 23 error, 2 usage error, 1 crash, 130 SIGINT, 143 SIGTERM. `translate` prints the TLA+, or on failure
 * a message on stderr and exit 21 (unsupported) or 23 (error).
 */
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cacheRoot, clearCaches } from "./cache.js";
import { check, invariantProblem, translateFile } from "./check.js";
import { render } from "./render.js";

const CHECK_USAGE = "quint-ts check <file.qnt> --invariant <expr> [--invariant <expr>...] [options]";
const TRANSLATE_USAGE = "quint-ts translate <file.qnt> [--invariant <expr>...] [options]";
const CACHE_USAGE = "quint-ts cache path|clear";
const TOP_USAGE = "quint-ts <command> [options]";

const CHECK_EXIT_CODES = "Exit codes: 0 passed, 20 violated, 21 unsupported, 22 inconclusive, 23 error, 2 usage error,\n" +
  "1 crash, 130 interrupted (SIGINT), 143 terminated (SIGTERM). Deadlock is not checked.";

const TOP_HELP = `Check Quint models without Java: Quint's own frontend, then the tla-ts model checker.

Examples:
  quint-ts check spec.qnt --main spec --invariant inv
  quint-ts check spec.qnt --invariant safe --invariant "balance >= 0" --timeout-ms 120000
  quint-ts check spec.qnt --invariant inv --json

Usage: ${TOP_USAGE}

Commands:
  check <file.qnt>       Check invariants in every reachable state
  translate <file.qnt>   Print the TLA+ module and configuration that check would run
  cache path|clear       Print or remove the checker's compile cache

Options:
  -h, --help             Print this help, or a command's with quint-ts <command> --help
  --version              Print the version

Exit codes of check: 0 passed, 20 violated, 21 unsupported, 22 inconclusive, 23 error,
2 usage error, 1 crash, 130 interrupted (SIGINT), 143 terminated (SIGTERM).
`;

const CHECK_HELP = `Check that each invariant holds in every reachable state of a Quint model.

Examples:
  quint-ts check spec.qnt --main spec --invariant inv
  quint-ts check spec.qnt --invariant inv --invariant "size(queue) <= 3"
  quint-ts check spec.qnt --invariant inv --out-itf counterexample.itf.json

Usage: ${CHECK_USAGE}

Options:
  --invariant <expr>     A definition name or an expression of the model. Required; repeat for more.
  --main <module>        The module to check (default: Quint's, from the file name)
  --init <action>        The initializer action (default: init)
  --step <action>        The step action (default: step)
  --timeout-ms <ms>      Time limit for the whole check, 1 to 2147483647 (default: 60000)
  --out-itf <file>       On a violation, also write the counterexample to <file> as ITF; nothing otherwise
  --json                 Print the result as JSON, the same object the check() API returns
  -h, --help             Print this help

The summary goes to stdout with the verdict last, and the next command, if any, to stderr.
${CHECK_EXIT_CODES}
`;

const TRANSLATE_HELP = `Print the TLA+ module and configuration that check would run.

Examples:
  quint-ts translate spec.qnt --main spec
  quint-ts translate spec.qnt --main spec --invariant inv

Usage: ${TRANSLATE_USAGE}

Options:
  --invariant <expr>     A definition name or an expression of the model; repeat for more
  --main <module>        The module to translate (default: Quint's, from the file name)
  --init <action>        The initializer action (default: init)
  --step <action>        The step action (default: step)
  -h, --help             Print this help

Exit codes: 0 translated, 21 unsupported, 23 error, 2 usage error, 1 crash. A failure prints a message on stderr.
`;

const CACHE_HELP = `Print or remove the checker's compile cache.

Examples:
  quint-ts cache path
  quint-ts cache clear

Usage: ${CACHE_USAGE}

Commands:
  path                   Print the cache folder
  clear                  Remove the cache folders and print each one removed; exits 0 when there is none

Options:
  -h, --help             Print this help

Exit codes: 0 done, 2 usage error, 1 crash.
`;

const USAGE: Record<string, string> = { check: CHECK_USAGE, translate: TRANSLATE_USAGE, cache: CACHE_USAGE };
const HELP: Record<string, string> = { check: CHECK_HELP, translate: TRANSLATE_HELP, cache: CACHE_HELP };

/** A usage error: the usage line first, then the problem with its next step, on stderr; exit 2. */
function usage(line: string, problem: string): never {
  console.error(`usage: ${line}\nquint-ts: ${problem}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const [command, ...rest] = args;

if (command === "--version") {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  console.log(version);
  process.exit(0);
}
// Help is asked for anywhere on the line, before the `--` that ends the options.
const optionArgs = args.slice(0, args.includes("--") ? args.indexOf("--") : undefined);
if (optionArgs.includes("--help") || optionArgs.includes("-h")) {
  process.stdout.write(HELP[command ?? ""] ?? TOP_HELP);
  process.exit(0);
}

if (command === "cache") {
  if (rest.length !== 1 || (rest[0] !== "path" && rest[0] !== "clear")) usage(CACHE_USAGE, "cache takes one argument, path or clear; run quint-ts cache --help");
  if (rest[0] === "path") console.log(cacheRoot());
  else for (const removed of clearCaches()) console.log(`removed ${removed}`);
  process.exit(0);
}
if (command !== "check" && command !== "translate") {
  usage(TOP_USAGE, command === undefined ? "no command given; run quint-ts --help for the commands" : `unknown command ${command}; run quint-ts --help for the commands`);
}
const commandUsage = USAGE[command] ?? TOP_USAGE;
const fail = (problem: string): never => usage(commandUsage, problem);

let parsed;
try {
  parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    tokens: true,
    options: {
      main: { type: "string" },
      init: { type: "string" },
      step: { type: "string" },
      // Each value goes to Quint whole: a comma inside it is Quint's own syntax, as in `quint compile --invariant`.
      invariant: { type: "string", multiple: true },
      "timeout-ms": { type: "string" },
      "out-itf": { type: "string" },
      json: { type: "boolean" },
    },
  });
} catch (err) {
  if (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS")) {
    // node:util names the option in quotes: `Unknown option '--x'`, or `Option '--invariant <value>' argument missing`.
    const name = /'(-[^'\s=]*)/.exec(err.message)?.[1] ?? "an option";
    if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      // The old name of --timeout-ms is not an alias: it stays unknown, with a fixed hint.
      fail(name === "--timeout" && command === "check"
        ? "unknown option --timeout; the time limit is --timeout-ms <ms>"
        : `unknown option ${name}; run quint-ts ${command} --help for the options`);
    }
    fail(`${name} needs a value; run quint-ts ${command} --help for the options`);
  }
  throw err;
}
const { values, positionals, tokens } = parsed;
for (const name of ["timeout-ms", "out-itf", "json"] as const) {
  if (command === "translate" && values[name] !== undefined) fail(`unknown option --${name}; run quint-ts translate --help for the options`);
}
for (const name of ["main", "init", "step", "timeout-ms", "out-itf", "json"]) {
  const times = tokens.filter((t) => t.kind === "option" && t.name === name).length;
  if (times > 1) fail(`--${name} given ${times === 2 ? "twice" : `${times} times`}; give it once`);
}
if (positionals.length !== 1) {
  fail(positionals.length === 0 ? `${command} needs a model file, such as quint-ts ${command} spec.qnt${command === "check" ? " --invariant inv" : ""}`
    : `unexpected argument ${positionals.slice(1).join(" ")}; ${command} takes one model file`);
}
const file = positionals[0] ?? "";
const invariants = values.invariant ?? [];
const selected = {
  ...values.main === undefined ? {} : { main: values.main },
  ...values.init === undefined ? {} : { init: values.init },
  ...values.step === undefined ? {} : { step: values.step },
};
const invariantsOk = (): void => {
  const problem = invariantProblem(invariants);
  if (problem !== undefined) fail(`${problem.replace(/^invariant /, "--invariant ")}, such as --invariant inv`);
};

if (command === "translate") {
  if (invariants.length > 0) invariantsOk();
  const t = translateFile(file, { ...selected, invariants });
  if (t.kind === "unsupported") {
    console.error(`quint-ts: unsupported: ${t.reason}, outside quint-ts's subset; nothing was translated`);
    process.exit(21);
  }
  if (t.kind === "frontend-error") {
    console.error(`${t.output.trimEnd()}\nquint-ts: error: Quint's frontend rejected the model (above); fix what it reports, then run the same command again`);
    process.exit(23);
  }
  console.log(`${t.translation.tla}\n\n\\* Q.cfg\n\\* ${t.translation.cfg.replaceAll("\n", "\n\\* ")}`);
  process.exit(0);
}

if (invariants.length === 0) fail("check needs at least one --invariant, such as --invariant inv");
invariantsOk();
const [first = "", ...others] = invariants;
// The largest delay a Node timer holds: past it a timer fires after 1 ms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const timeout = values["timeout-ms"];
const timeoutMs = timeout === undefined ? undefined : Number(timeout);
if (timeout !== undefined && (!/^[1-9]\d*$/.test(timeout) || !Number.isSafeInteger(timeoutMs) || (timeoutMs ?? 0) > MAX_TIMEOUT_MS)) {
  const shown = timeout.length > 24 ? `${timeout.slice(0, 24)}… (${timeout.length} characters)` : JSON.stringify(timeout);
  fail(`--timeout-ms takes a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, not ${shown}`);
}
const outItf = values["out-itf"];
if (outItf !== undefined) {
  if (outItf === "" || outItf === "-") fail("--out-itf takes a file; the result itself is printed on stdout");
  // Checked before the search, so a long check doesn't end with nowhere to write.
  const folder = dirname(resolve(outItf));
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) fail(`--out-itf ${outItf}: the folder ${folder} doesn't exist`);
  if (/\{(seq|test)\}/.test(outItf)) console.error(`quint-ts: warning: --out-itf ${outItf} is used as written; {seq} and {test} aren't replaced`);
}
// Ctrl-C and SIGTERM stop the check. On POSIX its children run in their own process group, so the signal
// reaches only this process, and the check stops every child it started before the CLI exits.
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 } as const;
const STATUS_EXIT = { passed: 0, violated: 20, unsupported: 21, inconclusive: 22, error: 23 } as const;
const stop = new AbortController();
// Only a person watching a terminal needs to know a check started; a script or a log doesn't.
if (process.stderr.isTTY) {
  console.error(`quint-ts: checking ${file} (${invariants.length === 1 ? "1 invariant" : `${invariants.length} invariants`}, time limit ${timeoutMs ?? 60_000} ms)`);
}
for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, () => stop.abort(name));
const result = await check(file, {
  ...selected,
  invariants: [first, ...others],
  ...timeoutMs === undefined ? {} : { timeoutMs },
  signal: stop.signal,
}).catch((err: unknown) => {
  if (stop.signal.aborted) process.exit(SIGNAL_EXIT[stop.signal.reason as keyof typeof SIGNAL_EXIT]);
  throw err;
});
if (values.json === true) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const shown = render(result, { file, ...selected, invariants, ...timeoutMs === undefined ? {} : { timeoutMs } });
  process.stdout.write(shown.stdout);
  process.stderr.write(shown.stderr);
}
if (outItf !== undefined) {
  if (result.status !== "violated") {
    console.error(`quint-ts: no counterexample; nothing written to ${outItf}`);
  } else {
    // Written whole or not at all: a partial file is renamed into place only once it is complete.
    const partial = `${outItf}.${process.pid}.partial`;
    try {
      writeFileSync(partial, `${JSON.stringify(result.trace)}\n`);
      renameSync(partial, outItf);
    } catch (err) {
      rmSync(partial, { force: true });
      console.error(`quint-ts: error: the counterexample couldn't be written to ${outItf}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(STATUS_EXIT.error);
    }
  }
}
process.exit(STATUS_EXIT[result.status]);
