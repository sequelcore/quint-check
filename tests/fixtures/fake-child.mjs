// A stand-in child for the runner's fault tests: node fake-child.mjs <mode> <pid file>
// It writes {"pid", "grandchild"?} to the pid file before doing what <mode> says.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [mode = "", pidFile = ""] = process.argv.slice(2);
const record = (grandchild) => writeFileSync(pidFile, JSON.stringify({ pid: process.pid, ...grandchild === undefined ? {} : { grandchild } }));
const busy = () => { for (;;) {} }; // CPU-bound, as a model check is: never yields to the event loop
// A Node grandchild that runs for a minute, with its stdio either detached from ours or holding our pipes.
const grandchild = (stdio) => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio }).pid;

switch (mode) {
  case "ok": record(); process.exit(0); break;
  case "crash": record(); process.stderr.write("partial output", () => process.exit(3)); break;
  case "hang": record(); busy(); break;
  case "idle": record(); setInterval(() => {}, 60_000); break; // runs until stopped, without using the CPU
  case "ignore-term": record(); process.on("SIGTERM", () => {}); setImmediate(busy); break;
  // Ignores SIGTERM and writes <pid file>.term when it arrives; idle, so the handler can run.
  case "note-term": record(); process.on("SIGTERM", () => writeFileSync(`${pidFile}.term`, "SIGTERM")); setInterval(() => {}, 60_000); break;
  case "selfkill": record(); process.kill(process.pid, "SIGKILL"); busy(); break;
  case "big-stderr": record(); process.stderr.write("x".repeat(20 * 1024 * 1024), () => process.exit(0)); break;
  case "grandchild-detached": record(grandchild("ignore")); busy(); break;
  case "grandchild-pipes": record(grandchild("inherit")); busy(); break;
  case "grandchild-pipes-exit": record(grandchild("inherit")); process.exit(0); break;
  // Windows only: a grandchild that isn't Node, so no job object of its own ends it.
  case "grandchild-native": record(spawn("ping", ["-n", "60", "127.0.0.1"], { stdio: "ignore" }).pid); busy(); break;
  default: process.exit(64);
}
