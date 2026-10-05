import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildSystemPrefix, parseMuseLine } from "./lib.ts";

type Backend = Parameters<OpenClawPluginApi["registerCliBackend"]>[0];

function buildMuseCliBackend(): Backend {
  return {
    id: "muse-cli",
    liveTest: {
      defaultModelRef: "muse-cli/muse-spark-1.3",
      defaultImageProbe: false,
      defaultMcpProbe: false,
    },
    nativeToolMode: "always-on",
    // La compaction OpenClaw vuole una API key che non esiste (backend CLI);
    // le sessioni backend sono monouso, nessun accumulo da compattare.
    ownsNativeCompaction: true,
    parseJsonlEvent: parseMuseLine,
    textTransforms: {
      input: [{ from: /^/, to: buildSystemPrefix() }],
    },
    // Backend solo-testo: i tool nativi restano spenti perché le approvazioni
    // headless restano appese in eterno (visto il 05/10 su un turno main).
    config: {
      command: "muse",
      args: [
        "exec",
        "--json",
        "--disable-shell",
        "--disable-write",
        "--disable-web-tools",
        "--disable-reminders",
        "--user-input-auto-resolve",
        "{prompt}",
      ],
      resumeArgs: [
        "exec",
        "--json",
        "--disable-shell",
        "--disable-write",
        "--disable-web-tools",
        "--disable-reminders",
        "--user-input-auto-resolve",
        "--session-id",
        "{sessionId}",
        "{prompt}",
      ],
      output: "jsonl",
      input: "arg",
      modelArg: "--model",
      imageArg: "--image",
      imageMode: "repeat",
      imagePathScope: "workspace",
      sessionMode: "existing",
      serialize: true,
    },
  };
}

export default definePluginEntry({
  id: "muse-cli",
  name: "Muse CLI",
  description: "Run Muse Spark via the local muse CLI subscription",
  register(api) {
    api.registerCliBackend(buildMuseCliBackend());
  },
});
