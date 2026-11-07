// A host process for the host-death test: it starts a long check and waits for it, until it's killed.
import { check } from "../../src/check.ts";

await check("tests/fixtures/unbounded.qnt", { main: "unbounded", invariants: ["inv"], timeoutMs: 120_000 });
