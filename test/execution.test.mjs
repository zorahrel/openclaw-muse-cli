import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeMuse, stageMuseConfig } from "../execution.mjs";
import { buildMuseCliBackend } from "../lib.js";

const root = mkdtempSync(join(tmpdir(), "muse-sdk-test-"));
const real = join(root, "real");
mkdirSync(real);
const original = { schema_version: 1, run: { code_mode: false }, mcpServers: { existing: { command: "echo" } } };
writeFileSync(join(real, "settings.json"), JSON.stringify(original));
writeFileSync(join(real, "auth.json"), '{"subscription":"fixture"}');
const mcp = join(root, "attempt.json");
const cli = join(root, "mock-cli.mjs");
writeFileSync(cli, `
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  const s = JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME, "muse", "settings.json")));
  console.log(JSON.stringify({payload_type:"run.terminal.completed",payload:{text:JSON.stringify({system:s.run.system_prompt,servers:s.mcpServers,args:process.argv.slice(2),pid:process.pid})}}));
  if (process.argv.includes("fail-after-terminal")) process.exit(1);
  if (process.argv.includes("wait")) { process.on("SIGTERM", () => {}); setInterval(() => {}, 100); }
`);
const a = stageMuseConfig(real);
const b = stageMuseConfig(real);
assert.notEqual(a.stagedXdg, b.stagedXdg);
const context = (staged, system, extraArgs = []) => ({
  command: process.execPath, args: [cli, "USER", ...extraArgs], prompt: "USER",
  cwd: root, env: { ...process.env, XDG_CONFIG_HOME: staged.stagedXdg, GEMINI_CLI_SYSTEM_SETTINGS_PATH: mcp },
  systemPrompt: system, useResume: extraArgs.includes("--session-id"), modelId: "fixture",
});
for (const [staged, system, capture, resume] of [[a, "SYSTEM_FIRST", "capture-first", []], [b, "SYSTEM_RESUME", "capture-resume", ["--session-id", "same-session"]]]) {
  // La capture arriva dopo prepareExecution, come nel core vero.
  writeFileSync(mcp, JSON.stringify({ mcpServers: { openclaw: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { "x-capture": capture } } } }));
  const c = context(staged, system, resume);
  c.promptContext = { prependContext: "HOST_PREPEND", appendContext: "HOST_APPEND" };
  const rows = [];
  for await (const row of executeMuse(c)) rows.push(row);
  assert.equal(rows[0].type, "result", "terminale riconosciuto dal contratto SDK");
  assert.equal(rows[0].is_error, false);
  const observed = JSON.parse(rows[0].payload.text);
  assert.equal(observed.system, system);
  assert.equal(observed.servers.openclaw.headers["x-capture"], capture);
  assert.equal(observed.servers.openclaw.type, "streamable-http");
  assert.deepEqual(observed.servers.existing, original.mcpServers.existing);
  assert.deepEqual(observed.args, ["HOST_PREPEND\n\nUSER\n\nHOST_APPEND", ...resume]);
  assert.equal(readFileSync(join(staged.stagedXdg, "muse", "auth.json"), "utf8"), '{"subscription":"fixture"}');
}
assert.deepEqual(JSON.parse(readFileSync(join(real, "settings.json"), "utf8")), original);
// Un terminale apparente non trasforma un exit non-zero in una consegna riuscita.
await assert.rejects(async () => {
  for await (const row of executeMuse(context(a, "FAIL", ["fail-after-terminal"]))) {}
}, /Muse exited with 1/);

// Il watchdog del core abortisce anche una CLI che ignora SIGTERM: niente orfani.
const controller = new AbortController();
const abortContext = { ...context(a, "ABORT", ["wait"]), abortSignal: controller.signal };
const iterator = executeMuse(abortContext);
const pid = JSON.parse((await iterator.next()).value.payload.text).pid;
const started = Date.now();
controller.abort(new Error("host watchdog"));
await assert.rejects(iterator.next(), /host watchdog/);
assert.ok(Date.now() - started < 4000);
assert.throws(() => process.kill(pid, 0), /ESRCH/);
await assert.rejects(async () => {
  for await (const row of executeMuse({ ...context(a, "FAIL"), command: join(root, "missing-cli") })) {}
}, /ENOENT/);

const memory = join(root, "memory.md");
writeFileSync(memory, "MEMORY_FIRST");
const backend = buildMuseCliBackend({ memoryFiles: [memory] });
const promptContext = { provider: "muse-cli", modelId: "muse-spark-1.3", modelDisplay: "muse-cli/muse-spark-1.3", systemPrompt: "CORE_RUNTIME_DISCORD", config: { plugins: { entries: { "muse-cli": { config: { role: "CONFIG_ROLE", memoryFiles: [memory] } } } } } };
assert.match(backend.transformSystemPrompt(promptContext), /MEMORY_FIRST/);
writeFileSync(memory, "MEMORY_CHANGED");
assert.match(backend.transformSystemPrompt(promptContext), /CONFIG_ROLE/);
assert.match(backend.transformSystemPrompt(promptContext), /MEMORY_CHANGED/);
assert.match(backend.transformSystemPrompt(promptContext), /CORE_RUNTIME_DISCORD/);
assert.equal(backend.textTransforms, undefined);
await a.cleanup();
await b.cleanup();
console.log("SDK execution: native system/resume/fresh MCP/context/abort and config isolation OK");
