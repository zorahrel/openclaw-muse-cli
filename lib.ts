import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Prefisso di sistema statico, letto al caricamento del plugin: `muse exec`
// non ha --system e OpenClaw non reinietta il system per questo backend.
// Si aggiorna a ogni reload del plugin. Ruolo e memorie vengono dalla config
// del plugin (default generico inglese, niente personale qui dentro).
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
  "You are a helpful personal assistant. " +
  "Your final text IS the message sent: direct, concise.";
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

// --- Ponte MCP ---
// Il core allestisce i server MCP in un file temporaneo (strategia gemini:
// GEMINI_CLI_SYSTEM_SETTINGS_PATH, con url e header/token già risolti); qui
// lo si traduce nel settings.json di muse, staged per singolo turno.
export interface BridgeMcpServer {
  type?: string;
  url?: string;
  command?: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || !v.every((a) => typeof a === "string")) return undefined;
  return [...(v as string[])];
}

// muse capisce "streamable-http", non "http" (con "http" prova ad avviare un
// processo e salta il server: visto in probe il 06/10).
function toMuseType(t: unknown): string | undefined {
  if (t === "http") return "streamable-http";
  return typeof t === "string" ? t : undefined;
}

export function extractMcpServers(stagedJson: unknown): Record<string, BridgeMcpServer> {
  if (!stagedJson || typeof stagedJson !== "object" || Array.isArray(stagedJson)) return {};
  const raw = (stagedJson as Record<string, unknown>).mcpServers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, BridgeMcpServer> = {};
  for (const [name, srv] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof name !== "string" || !name || !srv || typeof srv !== "object" || Array.isArray(srv)) continue;
    const s = srv as Record<string, unknown>;
    const entry: BridgeMcpServer = {};
    const type = toMuseType(s.type);
    if (type) entry.type = type;
    if (typeof s.url === "string") entry.url = s.url;
    if (typeof s.command === "string") entry.command = s.command;
    if (typeof s.cwd === "string") entry.cwd = s.cwd;
    const args = asStringList(s.args);
    if (args) entry.args = args;
    const env = asStringRecord(s.env);
    if (env) entry.env = env;
    const headers = asStringRecord(s.headers);
    if (headers) entry.headers = headers;
    if (type === "streamable-http") {
      // muse rifiuta command/args/env sul trasporto streamable
      delete entry.command;
      delete entry.args;
      delete entry.env;
    }
    out[name] = entry;
  }
  return out;
}

export function buildMuseSettings(
  base: unknown,
  servers: Record<string, BridgeMcpServer>,
): Record<string, unknown> {
  const out: Record<string, unknown> =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  const prev = out.mcpServers;
  out.mcpServers = {
    ...(prev && typeof prev === "object" && !Array.isArray(prev)
      ? (prev as Record<string, unknown>)
      : {}),
    ...servers,
  };
  return out;
}

export interface StagedMuseConfig {
  stagedXdg: string;
  serverCount: number;
  cleanup: () => Promise<void>;
}

export function proxyScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "proxy.mjs");
}

// Il server openclaw viaggia via proxy stdio: la capture key nasce a
// execute-time, dopo lo staging, e solo il proxy (figlio di muse) la legge
// fresca dal file attempt, identificato dal token del turno (stabile).
// Senza token il server passa invariato (diretto, come prima).
export function withProxy(
  servers: Record<string, BridgeMcpServer>,
  stagedDir?: string,
): Record<string, BridgeMcpServer> {
  const openclaw = servers.openclaw;
  const auth = openclaw?.headers?.Authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!openclaw?.url || !token) return servers;
  return {
    ...servers,
    openclaw: {
      command: process.execPath,
      args: [proxyScriptPath(), "openclaw", token, ...(stagedDir ? [stagedDir] : [])],
    },
  };
}

// Allestisce una XDG_CONFIG_HOME temporanea per un turno: settings.json reale
// + server MCP del core. auth/trust/skills restano in symlink a quelli
// dell'utente: l'autenticazione è sempre la sua subscription, mai copiata.
export function stageMuseConfig(geminiSettingsPath: string, realConfigDir?: string): StagedMuseConfig {
  const real = realConfigDir ?? join(homedir(), ".config", "muse");
  const stagedXdg = mkdtempSync(join(tmpdir(), "muse-xdg-"));
  const stagedMuse = join(stagedXdg, "muse");
  mkdirSync(stagedMuse, { recursive: true });
  const servers = withProxy(
    extractMcpServers(JSON.parse(readFileSync(geminiSettingsPath, "utf8"))),
    dirname(geminiSettingsPath),
  );
  let base: unknown = {};
  try {
    base = JSON.parse(readFileSync(join(real, "settings.json"), "utf8"));
  } catch {
    // senza base: solo MCP
  }
  writeFileSync(join(stagedMuse, "settings.json"), JSON.stringify(buildMuseSettings(base, servers)));
  for (const name of ["auth.json", "trust.json", "skills"]) {
    try {
      if (existsSync(join(real, name))) symlinkSync(join(real, name), join(stagedMuse, name));
    } catch {
      // voce mancante o già presente: si va avanti
    }
  }
  return {
    stagedXdg,
    serverCount: Object.keys(servers).length,
    cleanup: async () => {
      rmSync(stagedXdg, { recursive: true, force: true });
    },
  };
}
