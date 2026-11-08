/**
 * bun conformance/survey.ts --examples <Quint checkout> [--out conformance/public/SURVEY.md]
 *
 * Classifies every `.qnt` file under `examples/` of a Quint checkout the way
 * conformance/public/README.md describes, and writes one row per file. The
 * checkout must be at the commit the table is about, with `examples/`
 * unmodified. The table has no dates or timings; the same checkout gives the
 * same table.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { check, frontend, runQuint, tools, translateFile } from "../src/check.ts";

/** The Quint commit conformance/public/ and the survey are taken at. */
export const QUINT_COMMIT: string = "07d7a1a69c2093b5bc656caf3b5dfefa0d766cd0";
/** The longest one invariant's check may run; a model still running is `inconclusive`. */
const CHECK_TIMEOUT_MS = 30_000;

export type Outcome =
  | "no-init-step"   // Quint's frontend finds no `init` or `step`: a library or a test file
  | "frontend-error" // Quint's frontend rejects the file with its last module as main
  | "refused"        // translation refuses a construct
  | "definitive"     // translated, and an author's invariant got `passed` or `violated`
  | "inconclusive"   // translated, and the search of an author's invariant didn't finish
  | "no-invariant"   // translated, and the file declares no invariant that main can see
  | "error";         // translated, and the check failed or reached a construct it refuses

export interface Row {
  readonly main: string;
  readonly outcome: Outcome;
  readonly detail: string;
}

interface Declaration { kind?: string; name?: string; qualifier?: string; expr?: { kind?: string } }
interface Module { name: string; declarations: Declaration[] }

/** The modules of `file` as Quint parses them, or the parse error. */
function parseModules(file: string): { ok: true; modules: Module[] } | { ok: false; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-survey-"));
  try {
    const out = join(dir, "parsed.json");
    const ran = runQuint(["parse", "--out", out, file]);
    if (ran.status !== 0) return { ok: false, output: `${ran.stderr}${ran.stdout}`.trim() };
    return { ok: true, modules: (JSON.parse(readFileSync(out, "utf8")) as { modules: Module[] }).modules };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A name the authors give an invariant: `inv`, `tokenInv`, `safety_inv`, `invBallotsMatchPolls`. */
const INVARIANT_NAME = /^[iI]nv|Inv$|_inv$/;

/** The names, sorted, of the file's own definitions with no parameters that are named as invariants. */
function invariantNames(modules: readonly Module[]): string[] {
  const names = new Set<string>();
  for (const m of modules) {
    for (const d of m.declarations) {
      if (d.kind === "def" && ["val", "pureval", "def", "puredef"].includes(d.qualifier ?? "") && d.expr?.kind !== "lambda"
        && d.name !== undefined && INVARIANT_NAME.test(d.name)) names.add(d.name);
    }
  }
  return [...names].sort();
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 160);

/** Classify `file`, with its last module as the main module. */
export async function classify(file: string): Promise<Row> {
  const parsed = parseModules(file);
  if (!parsed.ok) return { main: "", outcome: "frontend-error", detail: oneLine(parsed.output) };
  const main = parsed.modules.at(-1)?.name;
  if (main === undefined) return { main: "", outcome: "frontend-error", detail: "no module" };

  const front = frontend(file, { main, invariants: [] });
  if (!front.ok) {
    const missing = /Name '(init|step)' not found/.exec(front.output);
    return missing !== null ? { main, outcome: "no-init-step", detail: `no ${missing[1]}` }
      : { main, outcome: "frontend-error", detail: oneLine(front.output) };
  }
  const translated = translateFile(file, { main, invariants: [] });
  if (translated.kind === "unsupported") return { main, outcome: "refused", detail: translated.reason };
  if (translated.kind === "frontend-error") return { main, outcome: "frontend-error", detail: oneLine(translated.output) };

  const verdicts: { text: string; kind: "definitive" | "inconclusive" | "error" }[] = [];
  for (const name of invariantNames(parsed.modules)) {
    const result = await check(file, { main, invariants: [name], timeoutMs: CHECK_TIMEOUT_MS });
    // A name `main` can't see (declared in a module it doesn't import) fails in the frontend, not in the model.
    if (result.status === "error" && result.stage === "frontend") continue;
    if (result.status === "passed") verdicts.push({ text: `${name}: passed, ${result.search.distinctStates} states`, kind: "definitive" });
    else if (result.status === "violated") verdicts.push({ text: `${name}: violated, ${result.trace.states.length} states in the counterexample`, kind: "definitive" });
    else if (result.status === "inconclusive") verdicts.push({ text: `${name}: inconclusive`, kind: "inconclusive" });
    else verdicts.push({ text: `${name}: ${result.status}`, kind: "error" });
  }
  if (verdicts.length === 0) return { main, outcome: "no-invariant", detail: "translated; no invariant of the authors to check" };
  const kind = verdicts.some((v) => v.kind === "definitive") ? "definitive" : verdicts.some((v) => v.kind === "inconclusive") ? "inconclusive" : "error";
  return { main, outcome: kind, detail: verdicts.map((v) => v.text).join("; ") };
}

/** Every `.qnt` file under `dir`, as paths relative to `base` with `/`, sorted. */
function qntFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? qntFiles(join(dir, e.name), base) : e.name.endsWith(".qnt") ? [relative(base, join(dir, e.name)).split(sep).join("/")] : [])
    .sort();
}

const git = (checkout: string, ...args: string[]): string => spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).stdout.trim();

const TRANSLATED: readonly [Outcome, string][] = [
  ["definitive", "a definitive verdict with the authors' invariant"],
  ["no-invariant", "no invariant of the authors to check"],
  ["inconclusive", "inconclusive"],
  ["error", "checked with an error"],
];
const OTHER: readonly [Outcome, string][] = [
  ["refused", "Refused by quint-ts"],
  ["frontend-error", "Rejected by Quint's frontend with the last module as main"],
  ["no-init-step", "Without `init` or `step`"],
];

/** The Markdown table for `rows`: totals, then one row per file. */
export function render(rows: readonly (Row & { file: string })[]): string {
  const count = (o: Outcome): number => rows.filter((r) => r.outcome === o).length;
  const translated = TRANSLATED.reduce((sum, [o]) => sum + count(o), 0);
  return [
    "# Survey of Quint's examples",
    "",
    `Generated by \`bun run survey -- --examples <Quint checkout>\` from \`examples/\` at Quint commit \`${QUINT_COMMIT}\`, with Quint ${tools.quintVersion} and tla-ts ${tools.tlaTsVersion}; don't edit by hand.`,
    "Each file's last module is the main module, and each value of that file named as an invariant (`INVARIANT_NAME` in [survey.ts](../survey.ts)) is checked on its own.",
    "",
    "| Outcome | Files |",
    "| --- | ---: |",
    `| All | ${rows.length} |`,
    `| Translated | ${translated} |`,
    ...TRANSLATED.map(([o, label]) => `| … ${label} | ${count(o)} |`),
    ...OTHER.map(([o, label]) => `| ${label} | ${count(o)} |`),
    "",
    "| File | Main module | Outcome | Detail |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| \`${r.file}\` | \`${r.main}\` | ${r.outcome} | ${r.detail.replaceAll("|", "\\|")} |`),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const checkout = arg("--examples");
  if (checkout === undefined) { console.error("usage: bun conformance/survey.ts --examples <Quint checkout> [--out <file>]"); process.exit(2); }
  const head = git(checkout, "rev-parse", "HEAD");
  if (head !== QUINT_COMMIT) { console.error(`${checkout} is at ${head || "no commit"}; the survey is taken at ${QUINT_COMMIT}`); process.exit(2); }
  if (git(checkout, "status", "--porcelain", "--", "examples") !== "") { console.error(`${checkout}/examples has changes; the survey needs it unmodified`); process.exit(2); }
  const rows: (Row & { file: string })[] = [];
  for (const file of qntFiles(join(checkout, "examples"))) {
    const row = await classify(join(checkout, "examples", file));
    console.log(`${file}: ${row.outcome} ${row.detail}`);
    rows.push({ file, ...row });
  }
  writeFileSync(arg("--out") ?? "conformance/public/SURVEY.md", render(rows));
}
