import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrefix, DEFAULT_ROLE, DEFAULT_SEPARATOR, parseMuseLine, readPluginConfig } from "../lib.js";

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
assert.ok(prefix.startsWith(DEFAULT_ROLE) && prefix.endsWith(`${DEFAULT_SEPARATOR}\n`));

// Prefisso personalizzato con file memoria, header e cap (replica setup reale).
const memDir = mkdtempSync(join(tmpdir(), "muse-mem-"));
writeFileSync(join(memDir, "a.md"), "AAA");
writeFileSync(join(memDir, "b.md"), "BBBBBBBBBB");
const custom = buildSystemPrefix({
  role: "R",
  memoryFiles: [{ path: join(memDir, "a.md"), header: "H1:" }, { path: join(memDir, "b.md"), chars: 4 }, join(memDir, "missing.md")],
  separator: "--- S ---",
});
assert.equal(custom, "R\n\nH1:\nAAA\n\nBBBB\n\n--- S ---\n");

// Config grezza: tollerante ai tipi sbagliati.
assert.deepEqual(readPluginConfig(null), {});
assert.deepEqual(readPluginConfig({ role: 42, separator: "", memoryChars: -1, memoryFiles: [42, { path: "" }] }), {});
assert.deepEqual(readPluginConfig({ role: "R", memoryChars: 100.9 }), { role: "R", memoryChars: 100 });

// Forma reale registrata il 06/10 dal finto server MCP (probe_echo).
const toolResult = JSON.stringify({
  stream: { kind: "session", id: "s" },
  payload_type: "tool.result",
  payload: {
    kind: "tool_result",
    call_id: "call_abc",
    text: "ECHO:PING",
    correlation_facts: { tool_name: "mcp__openclaw__probe_echo", outcome: "success" },
  },
});
assert.deepEqual(parseMuseLine(toolResult), [
  { kind: "toolStart", toolCallId: "call_abc", name: "mcp__openclaw__probe_echo" },
  { kind: "toolResult", toolCallId: "call_abc", name: "mcp__openclaw__probe_echo", result: "ECHO:PING" },
]);

const toolError = JSON.stringify({
  payload_type: "tool.result",
  payload: { kind: "tool_result", call_id: "call_e", text: "nope", correlation_facts: { outcome: "failed" } },
});
assert.deepEqual(parseMuseLine(toolError), [
  { kind: "toolStart", toolCallId: "call_e" },
  { kind: "toolResult", toolCallId: "call_e", isError: true, result: "nope" },
]);

assert.equal(parseMuseLine(JSON.stringify({ payload_type: "tool.result", payload: {} })), null);

const intent = JSON.stringify({
  payload_type: "task.lifecycle.side_effect_intent",
  payload: { event: { kind: "side_effect_intent", operation: "tool:mcp__openclaw__x" } },
});
assert.equal(parseMuseLine(intent), null);

console.log("parse.test.mjs: 15 assertions OK");
