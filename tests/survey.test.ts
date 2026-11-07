import { expect, test } from "bun:test";
import { classify } from "../conformance/survey.ts";

const pub = (file: string): string => `conformance/public/${file}`;

test("a file with a complete verdict on its authors' invariant is definitive", async () => {
  const row = await classify(pub("ewd426_3.qnt"));
  expect(row).toMatchObject({ main: "ewd426_3", outcome: "definitive" });
  expect(row.detail).toBe("tokenInv: passed, 729 states");
}, 120_000);

test("a counterexample on the authors' invariant is definitive too", async () => {
  const row = await classify(pub("games/secret-santa/secret_santa.qnt"));
  expect(row).toMatchObject({ main: "quint_team_secret_santa", outcome: "definitive" });
  expect(row.detail).toMatch(/^inv: violated, /);
}, 120_000);

test("a model that translates but declares no invariant has no verdict", async () => {
  const row = await classify(pub("booleans.qnt"));
  expect(row).toMatchObject({ main: "booleans", outcome: "no-invariant" });
}, 120_000);

test("a construct outside the subset is refused, naming it", async () => {
  const row = await classify(pub("weakFairness.qnt"));
  expect(row).toMatchObject({ main: "weakFairness", outcome: "refused", detail: "operator leadsTo" });
}, 120_000);

test("a library without init and step is told apart from a frontend failure", async () => {
  const row = await classify(pub("spells/basicSpells.qnt"));
  expect(row).toMatchObject({ main: "basicSpells", outcome: "no-init-step" });
}, 120_000);
