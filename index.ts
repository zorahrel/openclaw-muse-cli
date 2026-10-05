import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildSystemPrefix, parseMuseLine, stageMuseConfig } from "./lib.ts";

type Backend = Parameters<OpenClawPluginApi["registerCliBackend"]>[0];

function buildMuseCliBackend(): Backend {
  return {
    id: "muse-cli",
    liveTest: {
      defaultModelRef: "muse-cli/muse-spark-1.3",
      defaultImageProbe: false,
      defaultMcpProbe: true,
    },
    nativeToolMode: "always-on",
    // La compaction OpenClaw vuole una API key che non esiste (backend CLI);
    // le sessioni backend sono monouso, nessun accumulo da compattare.
    ownsNativeCompaction: true,
    bundleMcp: true,
    // Strategia gemini: il core scrive url + token già risolti in un file
    // temporaneo; prepareExecution lo traduce per muse. Se il core offrirà
    // una strategia nativa per muse si passa a quella.
    bundleMcpMode: "gemini-system-settings",
    // Hook solo ambiente/config: l'autenticazione è la subscription ambient di muse.
    autoSelectAuthProfile: false,
    // XDG_CONFIG_HOME staged per turno con i server MCP del core. Senza file
    // staged (o senza server) il turno resta solo-testo, mai rotto.
    prepareExecution: (ctx) => {
      const stagedPath = ctx.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      if (!stagedPath) return null;
      try {
        const staged = stageMuseConfig(stagedPath);
        if (staged.serverCount === 0) {
          void staged.cleanup();
          return null;
        }
        return { env: { XDG_CONFIG_HOME: staged.stagedXdg }, cleanup: staged.cleanup };
      } catch (err) {
        console.warn(`[muse-cli] staging MCP fallito, turno solo-testo: ${String(err)}`);
        return null;
      }
    },
    parseJsonlEvent: parseMuseLine,
    textTransforms: {
      input: [{ from: /^/, to: buildSystemPrefix() }],
    },
    // Tool nativi spenti (approvazioni headless appese: visto il 05/10);
    // i tool MCP girano liberi con --disable-approval, come gli altri backend.
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
        "--disable-approval",
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
        "--disable-approval",
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
