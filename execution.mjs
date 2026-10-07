// Contratto SDK prepareExecution.execute: il core possiede coda, capture MCP,
// prompt e watchdog; qui si adatta soltanto il trasporto nativo di Muse.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function stageMuseConfig(realConfigDir) {
  const real = realConfigDir ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "muse");
  const source = join(real, "settings.json");
  const settings = existsSync(source) ? JSON.parse(readFileSync(source, "utf8")) : {};
  const stagedXdg = mkdtempSync(join(tmpdir(), "muse-xdg-"));
  const stagedMuse = join(stagedXdg, "muse");
  mkdirSync(stagedMuse);
  writeFileSync(join(stagedMuse, "settings.json"), JSON.stringify(settings), { mode: 0o600 });
  for (const name of ["auth.json", "trust.json", "skills"]) {
    if (existsSync(join(real, name))) symlinkSync(join(real, name), join(stagedMuse, name));
  }
  return {
    stagedXdg,
    cleanup: async () => rmSync(stagedXdg, { recursive: true, force: true }),
  };
}

export function prepareMuseSettings(context) {
  if (!context.env.XDG_CONFIG_HOME) throw new Error("Missing per-turn Muse config");
  if (!context.systemPrompt.trim()) throw new Error("Missing OpenClaw system prompt");
  const settingsPath = join(context.env.XDG_CONFIG_HOME, "muse", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  // Il core ha già creato la capture del tentativo: gli header ora sono quelli
  // definitivi. Nessun proxy, ricerca di temp file o token in argv.
  const mcpPath = context.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  if (mcpPath) {
    const servers = JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers;
    const museServers = Object.fromEntries(Object.entries(servers ?? {}).map(([name, server]) => {
      if (server.type !== "http") return [name, server];
      const { command, args, env, ...http } = server;
      return [name, { ...http, type: "streamable-http" }];
    }));
    settings.mcpServers = { ...settings.mcpServers, ...museServers };
  }
  settings.run = { ...settings.run, system_prompt: context.systemPrompt };
  writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
}

export async function* executeMuse(context) {
  context.assertCurrent?.();
  context.abortSignal?.throwIfAborted();
  prepareMuseSettings(context);
  const args = [...context.args];
  if (context.promptContext) {
    const index = args.lastIndexOf(context.prompt);
    if (index < 0) throw new Error("Missing native Muse prompt argument");
    args[index] = [context.promptContext.prependContext, context.prompt, context.promptContext.appendContext]
      .filter(Boolean).join("\n\n");
  }
  const child = spawn(context.command, args, {
    cwd: context.cwd,
    env: context.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let spawnError;
  let exited = false;
  const closed = new Promise((resolve) => {
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-8000); });
  let killTimer;
  const terminate = () => {
    if (exited || killTimer) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
  };
  context.abortSignal?.addEventListener("abort", terminate, { once: true });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      context.abortSignal?.throwIfAborted();
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      // Il contratto execute SDK identifica il terminale con type=result;
      // il payload Muse resta intatto per parseJsonlEvent e per il transcript.
      if (record.payload_type?.startsWith("run.terminal.")) {
        yield { ...record, type: "result", is_error: record.payload_type !== "run.terminal.completed" };
      } else yield record;
    }
    const { code, signal } = await closed;
    context.abortSignal?.throwIfAborted();
    if (spawnError) throw spawnError;
    if (code !== 0) throw new Error(`Muse exited with ${signal ?? code}: ${stderr.trim()}`);
  } finally {
    context.abortSignal?.removeEventListener("abort", terminate);
    lines.close();
    terminate();
    await closed;
    clearTimeout(killTimer);
  }
}
