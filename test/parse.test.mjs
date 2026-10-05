import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMuseSettings, buildSystemPrefix, extractMcpServers, parseMuseLine, proxyScriptPath, stageMuseConfig, withProxy } from "../lib.ts";

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

// Forma del file staged dal core (url + header/token già risolti).
const staged = {
  mcpServers: {
    openclaw: {
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
      headers: { Authorization: "Bearer tok", "x-openclaw-cli-capture-key": "cap" },
    },
  },
};
assert.deepEqual(extractMcpServers(staged), {
  openclaw: {
    type: "streamable-http",
    url: "http://127.0.0.1:18789/mcp",
    headers: { Authorization: "Bearer tok", "x-openclaw-cli-capture-key": "cap" },
  },
});
assert.deepEqual(extractMcpServers(null), {});
assert.deepEqual(extractMcpServers({ mcpServers: { bad: "nope", empty: {} } }), { empty: {} });

assert.deepEqual(
  buildMuseSettings({ schema_version: 1, model: "m", mcpServers: { old: { type: "stdio" } } }, { fresh: {} }),
  { schema_version: 1, model: "m", mcpServers: { old: { type: "stdio" }, fresh: {} } },
);
assert.deepEqual(buildMuseSettings(null, { a: {} }), { mcpServers: { a: {} } });

// Staging vero su dir temporanee, con cleanup verificata.
const fakeReal = mkdtempSync(join(tmpdir(), "muse-real-"));
writeFileSync(join(fakeReal, "settings.json"), JSON.stringify({ schema_version: 1 }));
writeFileSync(join(fakeReal, "auth.json"), "{}");
const geminiFile = join(mkdtempSync(join(tmpdir(), "gemini-")), "settings.json");
writeFileSync(geminiFile, JSON.stringify(staged));
const stagedCfg = stageMuseConfig(geminiFile, fakeReal);
assert.equal(stagedCfg.serverCount, 1);
const written = JSON.parse(readFileSync(join(stagedCfg.stagedXdg, "muse", "settings.json"), "utf8"));
// openclaw viaggia via proxy stdio (capture key a execute-time), niente url/header.
assert.equal(written.mcpServers.openclaw.command, process.execPath);
assert.deepEqual(written.mcpServers.openclaw.args.slice(0, 2), [proxyScriptPath(), "openclaw"]);
assert.equal(written.mcpServers.openclaw.args[2], "tok");
assert.ok(existsSync(join(stagedCfg.stagedXdg, "muse", "auth.json")));
await stagedCfg.cleanup();
assert.ok(!existsSync(stagedCfg.stagedXdg));

const proxied = withProxy(
  {
    openclaw: { type: "streamable-http", url: "http://x/mcp", headers: { Authorization: "Bearer tok" } },
    other: { command: "s" },
  },
  "/tmp/stage",
);
assert.equal(proxied.openclaw.command, process.execPath);
assert.deepEqual(proxied.openclaw.args, [proxyScriptPath(), "openclaw", "tok", "/tmp/stage"]);
assert.deepEqual(proxied.other, { command: "s" });
assert.deepEqual(withProxy({ other: {} }), { other: {} });
// Senza token: invariato (diretto).
assert.deepEqual(withProxy({ openclaw: { url: "http://x/mcp" } }), { openclaw: { url: "http://x/mcp" } });
assert.ok(proxyScriptPath().endsWith("proxy.mjs") && existsSync(proxyScriptPath()));

console.log("parse.test.mjs: 25 assertions OK");
