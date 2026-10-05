import { strict as assert } from "node:assert";
import { buildSystemPrefix, parseMuseLine } from "../lib.ts";

// Forme reali registrate il 05/10 da `muse exec --json`.
const completed = JSON.stringify({
  stream: { kind: "session", id: "sess-1" },
  payload_type: "run.terminal.completed",
  payload: { kind: "run_terminal", terminal: "completed", text: "Ciao", reason: null },
});
assert.deepEqual(parseMuseLine(completed), { kind: "result", text: "Ciao", sessionId: "sess-1" });

const failed = JSON.stringify({
  stream: { kind: "session", id: "sess-2" },
  payload_type: "run.terminal.failed",
  payload: { kind: "run_terminal", terminal: "failed", reason: "boom" },
});
assert.deepEqual(parseMuseLine(failed), { kind: "result", errorText: "boom", sessionId: "sess-2" });

const delta = JSON.stringify({
  stream: { kind: "session", id: "s" },
  payload_type: "run.output.delta",
  payload: { kind: "run_output_delta", text: "par" },
});
assert.equal(parseMuseLine(delta), null);
assert.equal(parseMuseLine("muse: local session messaging disabled"), null);

const noText = JSON.stringify({
  stream: { kind: "session", id: "s" },
  payload_type: "run.terminal.completed",
  payload: { kind: "run_terminal", terminal: "completed" },
});
assert.deepEqual(parseMuseLine(noText), { kind: "result", text: "", sessionId: "s" });

const noSession = JSON.stringify({
  payload_type: "run.terminal.completed",
  payload: { kind: "run_terminal", terminal: "completed", text: "x" },
});
assert.deepEqual(parseMuseLine(noSession), { kind: "result", text: "x" });

const prefix = buildSystemPrefix();
assert.ok(prefix.includes("Jarvis") && prefix.endsWith("--- Messaggio ---\n"));

console.log("parse.test.mjs: 7 assertions OK");
