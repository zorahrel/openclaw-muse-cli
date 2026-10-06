import { strict as assert } from "node:assert";
import { MUSE_EXEC_BASE_ARGS } from "../lib.ts";

// I turni DEVONO poter eseguire (parità claude-cli): vietati i flag che
// spengono shell/scrittura (regressione NOSHELL del 06/10).
assert.ok(!MUSE_EXEC_BASE_ARGS.includes("--disable-shell"), "shell nativa accesa");
assert.ok(!MUSE_EXEC_BASE_ARGS.includes("--disable-write"), "scrittura nativa accesa");
// Run non interattivo: senza --disable-approval gli hang headless tornano.
assert.ok(MUSE_EXEC_BASE_ARGS.includes("--disable-approval"), "approval spenta");
assert.ok(MUSE_EXEC_BASE_ARGS.includes("--json"), "output json");
assert.equal(MUSE_EXEC_BASE_ARGS[0], "exec");
console.log("backend-args: ok");
