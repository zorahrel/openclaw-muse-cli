import { existsSync, readFileSync } from "node:fs";
import { executeMuse, stageMuseConfig } from "./execution.mjs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

// Parser dei record terminali di `muse exec --json` (record grezzi di
// session-log). Solo record terminale: niente streaming dei delta.
export function parseMuseLine(line: string) {
  let rec: any;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const streamId: unknown = rec?.stream?.id;
  const session = typeof streamId === "string" ? { sessionId: streamId } : null;
  const payloadType: unknown = rec?.payload_type;
  if (payloadType === "run.terminal.completed") {
    const text: unknown = rec?.payload?.text;
    return {
      kind: "result" as const,
      text: typeof text === "string" ? text : "",
      ...session,
    };
  }
  if (typeof payloadType === "string" && payloadType.startsWith("run.terminal.")) {
    const p = rec?.payload ?? {};
    return {
      kind: "result" as const,
      errorText: String(p.reason ?? p.text ?? payloadType),
      ...session,
    };
  }
  // Chiamata tool già eseguita dal backend: una sola riga tool.result porta
  // sia l'avvio sia l'esito (lo stdout non lega call_id al task_id, quindi la
  // coppia condivide il call_id). Esecuzione mai ripetuta dall'host.
  if (payloadType === "tool.result") {
    const p = rec?.payload ?? {};
    const callId: unknown = p.call_id;
    if (typeof callId !== "string" || !callId) return null;
    const facts = p.correlation_facts;
    const name: unknown = facts?.tool_name;
    const outcome: unknown = facts?.outcome;
    const start = {
      kind: "toolStart" as const,
      toolCallId: callId,
      ...(typeof name === "string" ? { name } : {}),
    };
    const result = {
      kind: "toolResult" as const,
      toolCallId: callId,
      ...(typeof name === "string" ? { name } : {}),
      ...(outcome !== undefined && outcome !== "success" ? { isError: true } : {}),
      ...(typeof p.text === "string" ? { result: p.text } : {}),
    };
    return [start, result];
  }
  return null;
}

// Flag base di `muse exec`: tool nativi ACCESI (shell+scrittura, parità
// claude-cli che gira con --dangerously-skip-permissions). --disable-approval
// tiene il run non interattivo (niente hang headless); --disable-sandbox apre
// rete/filesystem della shell (default proxy-only blocca il loopback verso il
// gateway, EPERM sui tool browser: visto il 06/10). Vietato riaggiungere
// --disable-shell/--disable-write: i turni DEVONO poter eseguire (NOSHELL 06/10).
export const MUSE_EXEC_BASE_ARGS = [
  "exec",
  "--json",
  "--disable-web-tools",
  "--disable-reminders",
  "--user-input-auto-resolve",
  "--disable-approval",
  "--disable-sandbox",
];

// Ruolo e memorie aggiuntive: lette per turno nel prompt di sistema OpenClaw,
// mai inserite nel messaggio utente né congelate al caricamento del plugin.
export interface MemoryFileRef {
  path: string;
  chars?: number;
  header?: string;
}

export interface SystemPrefixOptions {
  role?: string;
  memoryFiles?: Array<string | MemoryFileRef>;
  memoryChars?: number;
  separator?: string;
}

export const DEFAULT_ROLE =
  "You are a helpful personal assistant running in OpenClaw. " +
  "Follow the current runtime channel and reply delivery rules.";
export const DEFAULT_SEPARATOR = "--- Message ---";
export const DEFAULT_MEMORY_CHARS = 4000;

function asMemoryFileRef(v: unknown): MemoryFileRef | undefined {
  if (typeof v === "string" && v) return { path: v };
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.path !== "string" || !r.path) return undefined;
  const out: MemoryFileRef = { path: r.path };
  if (typeof r.chars === "number" && r.chars > 0) out.chars = Math.floor(r.chars);
  if (typeof r.header === "string" && r.header) out.header = r.header;
  return out;
}

// Normalizza la config grezza del plugin (tollerante: tipi sbagliati ignorati).
export function readPluginConfig(raw: unknown): SystemPrefixOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const c = raw as Record<string, unknown>;
  const out: SystemPrefixOptions = {};
  if (typeof c.role === "string" && c.role) out.role = c.role;
  if (Array.isArray(c.memoryFiles)) {
    const files = c.memoryFiles.flatMap((v) => {
      const ref = asMemoryFileRef(v);
      return ref ? [ref] : [];
    });
    if (files.length > 0) out.memoryFiles = files;
  }
  if (typeof c.memoryChars === "number" && c.memoryChars > 0) {
    out.memoryChars = Math.floor(c.memoryChars);
  }
  if (typeof c.separator === "string" && c.separator) out.separator = c.separator;
  return out;
}

export function buildSystemPrefix(opts: SystemPrefixOptions = {}): string {
  const parts = [opts.role ?? DEFAULT_ROLE];
  const fallbackChars = opts.memoryChars ?? DEFAULT_MEMORY_CHARS;
  for (const item of opts.memoryFiles ?? []) {
    const ref = typeof item === "string" ? { path: item } : item;
    try {
      if (!ref.path || !existsSync(ref.path)) continue;
      const cap = ref.chars ?? fallbackChars;
      const body = readFileSync(ref.path, "utf8").slice(0, cap);
      parts.push(ref.header ? `${ref.header}\n${body}` : body);
    } catch {
      // file illeggibile: si salta
    }
  }
  return parts.join("\n\n") + `\n\n${opts.separator ?? DEFAULT_SEPARATOR}\n`;
}

// --- Descrittore backend ---
// Unico builder per entry runtime (index.ts, con pluginConfig personale) e
// setup (setup-api.ts, stessa configurazione): i path senza registry runtime
// (agent exec embedded, discovery) risolvono da qui.
export type MuseCliBackend = Parameters<OpenClawPluginApi["registerCliBackend"]>[0];

export function buildMuseCliBackend(prefixOpts: SystemPrefixOptions): MuseCliBackend {
  return {
    id: "muse-cli",
    liveTest: {
      defaultModelRef: "muse-cli/muse-spark-1.3",
      defaultImageProbe: false,
      defaultMcpProbe: true,
    },
    nativeToolMode: "always-on",
    // Muse gestisce la propria compaction senza chiedere una API key al core.
    ownsNativeCompaction: true,
    bundleMcp: true,
    bundleMcpMode: "gemini-system-settings",
    autoSelectAuthProfile: false,
    prepareExecution: (ctx) => {
      // Anche senza MCP serve una config privata per il prompt dinamico.
      // Un errore di staging deve fallire: mai degradare in silenzio a solo testo.
      const staged = stageMuseConfig();
      return { env: { XDG_CONFIG_HOME: staged.stagedXdg }, cleanup: staged.cleanup, execute: executeMuse };
    },
    parseJsonlEvent: parseMuseLine,
    resolveExecutionArgs: (ctx) => ctx.thinkingLevel && ctx.thinkingLevel !== "adaptive"
      // Meta rifiuta none, anche se compare nell'help della CLI.
      ? [...ctx.baseArgs, "--reasoning-effort", ctx.thinkingLevel === "off" ? "minimal" : ctx.thinkingLevel]
      : ctx.baseArgs,
    transformSystemPrompt: (ctx) => buildSystemPrefix(readPluginConfig(
      ctx.config?.plugins?.entries?.["muse-cli"]?.config ?? prefixOpts,
    )) + ctx.systemPrompt,
    // Tool nativi accesi (shell+scrittura): parità con claude-cli, che gira
    // con --dangerously-skip-permissions. --disable-approval nel base tiene il
    // run non interattivo senza hang headless.
    config: {
      command: "muse",
      args: [...MUSE_EXEC_BASE_ARGS, "{prompt}"],
      resumeArgs: [...MUSE_EXEC_BASE_ARGS, "--session-id", "{sessionId}", "{prompt}"],
      systemPromptWhen: "always",
      output: "jsonl",
      input: "arg",
      modelArg: "--model",
      imageArg: "--image",
      imageMode: "repeat",
      imagePathScope: "workspace",
      sessionMode: "existing",
      // Il core serializza già la singola sessione; canali diversi non si bloccano.
      serialize: false,
    },
  };
}
