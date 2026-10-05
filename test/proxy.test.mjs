import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proxyScriptPath } from "../lib.ts";

// Finto server MCP streamable-HTTP: session id + echo, registra gli header.
const seen = [];
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    seen.push({ auth: req.headers.authorization, cap: req.headers["x-cap"], sid: req.headers["mcp-session-id"] });
    const msg = JSON.parse(body || "{}");
    res.setHeader("Mcp-Session-Id", "sess-1");
    if (msg.method === "initialize") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "x", capabilities: {}, serverInfo: { name: "p", version: "1" } } }));
    } else if (msg.method === "tools/call") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `ECHO:${msg.params.arguments.text}` }] } }));
    } else if (msg.id === undefined) {
      res.statusCode = 202;
      res.end();
    } else {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    }
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/mcp`;

// Dir stile attempt del core (stesso prefisso, settings.json dentro),
// con una vicina dal token diverso.
const dir = mkdtempSync(join(tmpdir(), "attempt-dir-"));
const attempt = join(dir, "openclaw-gemini-mcp-attempt-aaa");
mkdirSync(attempt);
writeFileSync(
  join(attempt, "settings.json"),
  JSON.stringify({ mcpServers: { openclaw: { url, headers: { Authorization: "Bearer tok", "x-cap": "cap" } } } }),
);
const other = join(dir, "openclaw-gemini-mcp-attempt-bbb");
mkdirSync(other);
writeFileSync(
  join(other, "settings.json"),
  JSON.stringify({ mcpServers: { openclaw: { url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer other", "x-cap": "x" } } } }),
);

const child = spawn(process.execPath, [proxyScriptPath(), "openclaw", "tok", dir], {
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = [];
let pending = "";
child.stdout.on("data", (c) => {
  pending += c;
  let i;
  while ((i = pending.indexOf("\n")) >= 0) {
    lines.push(pending.slice(0, i));
    pending = pending.slice(i + 1);
  }
});
function rpc(msg) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (lines.length > 0) {
        clearInterval(timer);
        resolve(JSON.parse(lines.shift()));
      }
    }, 20);
    child.stdin.write(JSON.stringify(msg) + "\n");
  });
}

const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
assert.equal(init.result.serverInfo.name, "p");
const call = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "e", arguments: { text: "PING" } } });
assert.equal(call.result.content[0].text, "ECHO:PING");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await new Promise((r) => setTimeout(r, 500));

assert.equal(seen.length, 3);
assert.ok(seen.every((h) => h.auth === "Bearer tok" && h.cap === "cap"));
assert.equal(seen[0].sid, undefined);
assert.equal(seen[1].sid, "sess-1");

child.kill();

// Token sconosciuto: esce 1 senza toccare la rete.
const bad = spawn(process.execPath, [proxyScriptPath(), "openclaw", "nope", dir], {
  stdio: ["ignore", "ignore", "pipe"],
});
let err = "";
bad.stderr.on("data", (c) => { err += c; });
const code = await new Promise((r) => bad.on("close", r));
assert.equal(code, 1);
assert.match(err, /non trovato/);
assert.equal(seen.length, 3);

srv.close();
console.log("proxy.test.mjs: 9 assertions OK");
