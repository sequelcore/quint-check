import { spawnSync } from "node:child_process";

/** Whether the checkout at `root` has changes other than the results the harness and benchmarks generate. */
export function sourceChanged(root: string): boolean {
  const generated = [":!conformance/results", ":!conformance/MATRIX.md", ":!bench/results", ":!bench/BASELINE.md", ":!bench/COMPARISON.md"];
  return spawnSync("git", ["status", "--porcelain", "--", ".", ...generated], { encoding: "utf8", cwd: root }).stdout.trim() !== "";
}
