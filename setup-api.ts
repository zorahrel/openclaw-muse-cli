import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildMuseCliBackend } from "./lib.ts";

// Entry setup leggera (come extensions/anthropic/setup-api.ts): stesso
// descrittore, default generici senza pluginConfig personale. Serve ai path
// che risolvono il backend senza registry runtime (agent exec embedded,
// discovery): senza questo file danno "Unknown CLI backend: muse-cli".
export default definePluginEntry({
  id: "muse-cli",
  name: "Muse CLI Setup",
  description: "Lightweight Muse CLI setup hooks",
  register(api) {
    api.registerCliBackend(buildMuseCliBackend({}));
  },
});
