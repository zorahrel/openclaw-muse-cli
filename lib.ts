import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  return null;
}

// Prefisso di sistema statico, letto al caricamento del plugin: `muse exec`
// non ha --system e OpenClaw non reinietta il system per questo backend.
// Si aggiorna a ogni reload del plugin.
export function buildSystemPrefix(): string {
  const parts = [
    "Sei Jarvis, l'assistente personale di Attilio Cianci, e rispondi su WhatsApp. " +
      "Il tuo testo finale È il messaggio inviato: diretto, conciso, italiano. Mai meta-commenti.",
  ];
  try {
    const memPath = join(homedir(), ".openclaw", "MEMORY.md");
    if (existsSync(memPath)) {
      parts.push("Memoria di lungo periodo:\n" + readFileSync(memPath, "utf8").slice(0, 4000));
    }
    const storiaPath = join(homedir(), ".openclaw", "memory", "2026-10-05-storia.md");
    if (existsSync(storiaPath)) {
      parts.push("Storia precedente (da archivio):\n" + readFileSync(storiaPath, "utf8").slice(0, 6000));
    }
  } catch {
    // senza memoria: resta il ruolo
  }
  return parts.join("\n\n") + "\n\n--- Messaggio ---\n";
}
