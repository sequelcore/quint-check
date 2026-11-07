// A stand-in for the checker child, for the paths where its result mustn't count: node fake-checker.mjs <run folder>
// It does what <run folder>/mode says. Each result it writes would be a pass if quint-ts trusted it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "";
const passing = { kind: "checked", status: "success", distinctStates: 20, queuedStates: 0, initialStates: 1 };
const write = (text) => writeFileSync(join(dir, "result.json"), text);

switch (readFileSync(join(dir, "mode"), "utf8")) {
  case "pass": write(JSON.stringify(passing)); process.exit(0); break;
  case "exit-3": write(JSON.stringify(passing)); process.exit(3); break;
  case "killed": write(JSON.stringify(passing)); process.kill(process.pid, "SIGKILL"); break;
  case "no-result": process.exit(0); break;
  case "partial": write(JSON.stringify(passing).slice(0, -5)); process.exit(0); break;
  case "malformed": write(JSON.stringify({ ...passing, distinctStates: "20" })); process.exit(0); break;
  default: process.exit(64);
}
