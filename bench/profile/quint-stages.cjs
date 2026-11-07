// Times the stages of `quint compile --target json` in one process, by calling
// the stage functions Quint's CLI chains (dist/src/cliCommands.js). Those are
// internal to Quint: this script measures, nothing in src/ depends on them.
// Usage: node|bun quint-stages.cjs <quint package dir> <file.qnt> <main> <invariant> <runs>
const { performance } = require("node:perf_hooks");
const path = require("node:path");
const [quintDir, file, main, invariant, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 5);

let t = performance.now();
const cli = require(path.join(quintDir, "dist", "src", "cliCommands.js"));
const loadModulesMs = performance.now() - t;

const ms = (start) => performance.now() - start;

async function once() {
  const args = { input: path.resolve(file), main, target: "json", flatten: true, verbosity: 0, invariant, out: undefined };
  const times = {};
  let s = performance.now();
  const loaded = await cli.load(args);
  times.read = ms(s);
  s = performance.now();
  const parsed = await loaded.asyncChain((st) => cli.parse(st));
  times.parse = ms(s);
  s = performance.now();
  const typed = await parsed.asyncChain((st) => cli.typecheck(st));
  times.typecheck = ms(s);
  s = performance.now();
  const compiled = await typed.asyncChain((st) => cli.compile(st));
  times.flatten = ms(s);
  // outputCompilationTarget writes the JSON to standard output; capture it instead.
  const write = process.stdout.write.bind(process.stdout);
  let bytes = 0;
  process.stdout.write = (chunk) => { bytes += chunk.length; return true; };
  s = performance.now();
  const out = await compiled.asyncChain((st) => cli.outputCompilationTarget(st));
  times.serialize = ms(s);
  process.stdout.write = write;
  if (out.isLeft()) throw new Error(`a stage failed: ${JSON.stringify(out.value).slice(0, 300)}`);
  times.bytes = bytes;
  return times;
}

(async () => {
  const all = [];
  for (let k = 0; k < runs; k += 1) all.push(await once());
  const median = (key) => { const v = all.map((x) => x[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const report = { runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`, loadModulesMs,
    firstRun: all[0], median: Object.fromEntries(["read", "parse", "typecheck", "flatten", "serialize", "bytes"].map((k) => [k, median(k)])) };
  console.log(JSON.stringify(report));
})().catch((err) => { console.error(err); process.exit(1); });
