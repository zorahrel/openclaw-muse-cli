#!/usr/bin/env node
// Ponte MCP stdio→HTTP per muse: trova il file attempt del turno (l'unico col
// token atteso e la capture key fresca), poi inoltra JSON-RPC linea per linea.
// Avviato da muse a ogni turno, dopo il capture attempt: niente stantio.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const serverName = process.argv[2] || "openclaw";
const expectToken = process.argv[3];
const expectDir = process.argv[4];

function fail(msg) {
  console.error(`[muse-mcp-proxy] ${msg}`);
  process.exit(1);
}

// muse non passa l'env ai server stdio: token atteso e dir arrivano via argv
// (statici, noti già al prepare). Il token identifica il file attempt del turno.
if (!expectToken) fail("token atteso mancante (argv[3])");

function candidateFiles() {
  const roots = [...new Set([expectDir, process.env.TMPDIR, tmpdir(), "/tmp"].filter(Boolean))];
  const out = [];
  const pushJson = (dir) => {
    const f = join(dir, "settings.json");
    try {
      if (statSync(f).isFile()) out.push(f);
    } catch {
      // non è una dir staged
    }
  };
  for (const root of roots) {
    pushJson(root);
    let names;
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("openclaw-gemini-mcp-")) continue;
      const full = join(root, name);
      try {
        if (statSync(full).isDirectory()) pushJson(full);
        else out.push(full);
      } catch {
        // sparito nel frattempo
      }
    }
  }
  // attempt per primi (hanno la capture key), poi gli altri.
  out.sort((a, b) => Number(b.includes("-attempt-")) - Number(a.includes("-attempt-")));
  return [...new Set(out)];
}

function complete(entry) {
  const h = entry?.headers;
  return (
    typeof entry?.url === "string" &&
    !!entry.url &&
    !!h &&
    typeof h === "object" &&
    Object.values(h).every((v) => typeof v === "string" && v.length > 0)
  );
}

function findEntry() {
  let fallback;
  for (const file of candidateFiles()) {
    let entry;
    try {
      entry = JSON.parse(readFileSync(file, "utf8")).mcpServers?.[serverName];
    } catch {
      continue;
    }
    if (entry?.url === undefined || entry.headers?.Authorization !== `Bearer ${expectToken}`) continue;
    if (complete(entry)) return entry;
    fallback ??= entry;
  }
  return fallback;
}

const entry = findEntry();
if (!entry?.url) fail("file attempt del turno non trovato");
const headers = { ...(typeof entry.headers === "object" && entry.headers !== null ? entry.headers : {}) };
if (Object.values(headers).some((v) => typeof v !== "string" || v.length === 0)) {
  fail("header incompleti nel file attempt");
}

let sessionId;
async function post(body) {
  const res = await fetch(entry.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body,
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (res.status === 202) return [];
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("text/event-stream")) return [text];
  // SSE minimo: solo righe data:, event: scartati.
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((d) => d && d !== "[DONE]");
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    continue;
  }
  try {
    const out = await post(trimmed);
    // Notifiche (senza id): inoltrate, nessuna risposta attesa.
    if (msg.id === undefined || msg.id === null) continue;
    for (const chunk of out) console.log(chunk);
  } catch (err) {
    if (msg.id === undefined || msg.id === null) continue;
    console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(err).slice(0, 300) } }));
  }
}
