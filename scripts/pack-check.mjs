#!/usr/bin/env node
// node scripts/pack-check.mjs [<tarball>]
//
// Packs quint-check with npm, or takes the given tarball (the release workflow's, which it then publishes
// unchanged), installs the tarball into a new project outside
// this repository, and checks the three demo models through the installed
// CLI and API, with Node only: the check fails if Bun or Java is on PATH,
// and if a development dependency got installed. Exits non-zero on any
// unexpected result.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const work = mkdtempSync(join(tmpdir(), "quint-check-pack-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
// On Windows, PATH holds only Node's folder and System32, so neither Bun nor Java can be found. Elsewhere the
// system folders can hold Java (Ubuntu runners do), so stand-ins for java and bun come first on PATH and leave a
// mark if anything runs them; the check requires no mark.
const windows = process.platform === "win32";
const shims = join(work, "shims");
const used = join(work, "used");
const system = windows ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : [shims, "/usr/bin", "/bin"];
if (!windows) {
  mkdirSync(shims);
  for (const tool of ["java", "bun"]) {
    writeFileSync(join(shims, tool), `#!/bin/sh\necho ${tool} >> "${used}"\nexit 97\n`, { mode: 0o755 });
  }
}
const env = { ...process.env, PATH: (windows ? [dirname(process.execPath), ...system] : [shims, dirname(process.execPath), ...system.slice(1)]).join(delimiter) };
// npm and npx are .cmd scripts on Windows, which only a shell can start; Node itself starts directly.
const shellFor = (cmd) => cmd.endsWith(".cmd");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, encoding: "utf8", shell: shellFor(cmd) });
let failures = 0;
const expect = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures += 1; };

try {
  if (windows) {
    for (const tool of ["bun", "java"]) {
      const found = spawnSync("where", [tool], { env, encoding: "utf8" }).status === 0;
      expect(!found, `${tool} is not on PATH`);
    }
  }
  const given = process.argv[2];
  const packed = given === undefined ? run(npm, ["pack", "--pack-destination", work, "--silent"], root).trim().split(/\r?\n/).at(-1) : given;
  const tarball = given === undefined ? join(work, packed) : resolve(given);
  expect(existsSync(tarball), given === undefined ? `npm pack wrote ${packed}` : `the tarball ${given} exists`);
  const project = join(work, "consumer");
  mkdirSync(project);
  run(npm, ["init", "-y"], project);
  run(npm, ["install", "--no-audit", "--no-fund", tarball], project);
  for (const dev of ["typescript", "@types/bun"]) expect(!existsSync(join(project, "node_modules", dev)), `development dependency ${dev} is not installed`);

  const demos = [["mutex", "passed", 0], ["mutex_bug", "violated", 20], ["mutex_list", "unsupported", 21]];
  for (const [name, status, code] of demos) {
    const args = ["--no-install", "quint-check", "check", `node_modules/@sequelcore/quint-check/demo/${name}.qnt`, "--main", name, "--invariant", "inv"];
    const ran = spawnSync(npx, args, { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
    const verdict = ran.stdout.trimEnd().split("\n").at(-1) ?? "";
    expect(verdict.startsWith(`${status}: `) && ran.status === code, `CLI ${name}: "${verdict}", exit ${ran.status} (expected ${status}, exit ${code})`);
    const json = spawnSync(npx, [...args, "--json"], { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
    const result = JSON.parse(json.stdout);
    expect(result.status === status && json.status === code, `CLI ${name} --json: ${result.status}, exit ${json.status} (expected ${status}, exit ${code})`);
  }
  // The docs as installed: each `npx quint-check check` command they show runs, and its stdout (and stderr, when
  // a second text block follows) equals the text blocks after it, so a page can't show output the tool doesn't print.
  for (const page of ["README.md", "docs/quickstart.md"]) {
    const text = readFileSync(join(project, "node_modules", "@sequelcore", "quint-check", page), "utf8").replaceAll("\r\n", "\n");
    const blocks = [...text.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
    let shown = 0;
    blocks.forEach((block, i) => {
      const command = block.lang === "sh" && block.body.trim().startsWith("npx quint-check check ") ? block.body.trim() : undefined;
      if (command === undefined) return;
      const outputs = [];
      for (const next of blocks.slice(i + 1)) {
        if (next.lang !== "text") break;
        outputs.push(next.body);
      }
      if (outputs.length === 0) return;
      const ran = spawnSync(npx, ["--no-install", ...command.split(/\s+/).slice(1)], { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
      const same = (actual, expected) => actual.replaceAll("\r\n", "\n") === expected;
      expect(same(ran.stdout, outputs[0]) && (outputs[1] === undefined || same(ran.stderr, outputs[1])),
        `${page}: "${command.slice(0, 60)}…" prints what the page shows`);
      shown += 1;
    });
    expect(shown > 0, `${page} shows at least one command with its output`);
  }
  // The old name of the time limit is refused with a hint, never accepted.
  const oldName = spawnSync(npx, ["--no-install", "quint-check", "check", "node_modules/@sequelcore/quint-check/demo/mutex.qnt", "--main", "mutex", "--invariant", "inv", "--timeout", "5000"],
    { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
  expect(oldName.status === 2 && oldName.stdout === "" && oldName.stderr.includes("--timeout-ms"), `CLI --timeout: exit ${oldName.status} (expected a usage error naming --timeout-ms, exit 2)`);
  const help = spawnSync(npx, ["--no-install", "quint-check", "check", "--help"], { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
  expect(help.status === 0 && help.stderr === "" && help.stdout.includes("--timeout-ms <ms>"), `CLI check --help: exit ${help.status}`);
  const version = spawnSync(npx, ["--no-install", "quint-check", "--version"], { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
  expect(version.status === 0 && version.stdout.trim() === packageVersion, `CLI --version: ${version.stdout.trim()}, exit ${version.status} (expected ${packageVersion})`);
  // A misspelled flag is a usage error under Node too, never a check without an invariant.
  const typo = spawnSync(npx, ["--no-install", "quint-check", "check", "node_modules/@sequelcore/quint-check/demo/mutex.qnt", "--main", "mutex", "--invarient", "inv"],
    { cwd: project, env, encoding: "utf8", shell: shellFor(npx) });
  expect(typo.status === 2 && typo.stdout === "" && typo.stderr.includes("--invarient"), `CLI --invarient: exit ${typo.status} (expected a usage error, exit 2)`);
  writeFileSync(join(project, "api.mjs"), `import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { check } from "@sequelcore/quint-check";
const model = "node_modules/@sequelcore/quint-check/demo/mutex.qnt";
const r = await check(model, { main: "mutex", invariants: ["inv"] });
const message = (p) => p.then(() => "resolved", (e) => e.name + ": " + e.message);
const aborted = await message(check(model, { main: "mutex", invariants: ["inv"], signal: AbortSignal.timeout(300) }));
const badTimeout = await message(check(model, { main: "mutex", invariants: ["inv"], timeoutMs: Infinity }));
const left = readdirSync(tmpdir()).filter((n) => n.startsWith("quint-check-run-" + process.pid + "-")).length;
console.log(JSON.stringify({ status: r.status, states: r.search?.distinctStates, scope: r.guarantee.scope, aborted, badTimeout, left }));
`);
  const api = JSON.parse(run(process.execPath, ["api.mjs"], project));
  expect(api.status === "passed" && api.states === 20 && api.scope === "complete", `API mutex: ${api.status}, ${api.states} states, scope ${api.scope}`);
  expect(api.aborted.includes("TimeoutError"), `API abort through a signal: ${api.aborted}`);
  expect(api.badTimeout.startsWith("RangeError"), `API timeoutMs: Infinity: ${api.badTimeout}`);
  expect(api.left === 0, `API checks left ${api.left} run folders`);
  if (!windows) expect(!existsSync(used), "nothing ran java or bun");
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failures === 0 ? "the installed package works with Node only" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
