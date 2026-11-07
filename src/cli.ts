#!/usr/bin/env node
/**
 * quint-ts check <file.qnt> [--main M] [--init I] [--step S] [--invariant inv[,inv]] [--timeout ms]
 * quint-ts translate <file.qnt> [same options]
 * quint-ts cache path|clear
 * Prints the result as JSON. Exits 0 only when the check passed.
 */
import { cacheRoot, clearCaches } from "./cache.js";
import { check, translateFile, type CheckOptions } from "./check.js";

const [command, file, ...rest] = process.argv.slice(2);
if (command === "cache" && (file === "path" || file === "clear")) {
  if (file === "path") console.log(cacheRoot());
  else for (const removed of clearCaches()) console.log(`removed ${removed}`);
  process.exit(0);
}
const flag = (n: string): string | undefined => {
  const k = rest.indexOf(`--${n}`);
  return k === -1 ? undefined : rest[k + 1];
};
if ((command !== "check" && command !== "translate") || file === undefined) {
  console.error("usage: quint-ts check|translate <file.qnt> [--main M] [--init I] [--step S] [--invariant inv] [--timeout ms]\n" +
    "       quint-ts cache path|clear");
  process.exit(2);
}
const main = flag("main");
const init = flag("init");
const step = flag("step");
const options: CheckOptions = {
  invariants: flag("invariant")?.split(",").filter((s) => s !== "") ?? [],
  timeoutMs: Number(flag("timeout") ?? 60_000),
  ...main === undefined ? {} : { main },
  ...init === undefined ? {} : { init },
  ...step === undefined ? {} : { step },
};
if (command === "translate") {
  const t = translateFile(file, options);
  if (t.kind !== "translated") {
    console.log(JSON.stringify(t, null, 2));
    process.exit(1);
  }
  console.log(`${t.translation.tla}\n\n\\* Q.cfg\n\\* ${t.translation.cfg.replaceAll("\n", "\n\\* ")}`);
  process.exit(0);
}
const result = check(file, options);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "passed" ? 0 : 1);
