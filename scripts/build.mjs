import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Gli archivi OpenClaw richiedono JavaScript già emesso; il checkout conserva
// le sorgenti TypeScript senza introdurre un compilatore o dipendenze di build.
for (const name of ["index", "lib", "setup-api"]) {
  const source = new URL(`../${name}.ts`, import.meta.url);
  const output = stripTypeScriptTypes(readFileSync(source, "utf8"), { mode: "strip" })
    .replaceAll('"./lib.ts"', '"./lib.js"');
  writeFileSync(new URL(`../${name}.js`, import.meta.url), output);
}
