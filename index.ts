import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildMuseCliBackend, readPluginConfig } from "./lib.ts";

export default definePluginEntry({
  id: "muse-cli",
  name: "Muse CLI",
  description: "Run Muse Spark via the local muse CLI subscription",
  register(api) {
    api.registerCliBackend(buildMuseCliBackend(readPluginConfig(api.pluginConfig)));
  },
});
