# openclaw-muse-cli

Backend OpenClaw che esegue Muse Spark via la subscription dell'utente
(`muse exec`, niente API key, marginali $0).

## Stato

Funzionante come primario chat (verificato 05/10/2026 su OpenClaw 2026.9.5):
risposta ~5s, resume fra turni, consegna WhatsApp diretta. Non ancora a
livello top-provider: manca il ponte MCP per i tool (vedi sotto).

## Installazione (locale)

```bash
openclaw plugins install --link ~/Projects/openclaw-muse-cli --force --accept-capabilities
openclaw plugins enable muse-cli --accept-capabilities
openclaw plugins inspect muse-cli --runtime   # loaded, zero diagnostics
```

Mai `plugins reload` durante un turno attivo (fallisce): a gateway fermo.

## Configurazione

```json5
{
  agents: {
    defaults: {
      model: { primary: "muse-cli/muse-spark-1.3", fallbacks: ["openai/gpt-6.1-sol"] },
      models: { "muse-cli/muse-spark-1.3": { alias: "spark" } },
      modelPolicy: { allow: ["muse-cli/*"] }
    },
    entries: { main: { model: "muse-cli/muse-spark-1.3" } }
  }
}
```

Il routing vero per sessioni esistenti è l'override in
`session_nodes.entry_json` (`providerOverride`/`modelOverride`, source=user):
batte defaults ed entry. Nuove sessioni seguono la config.

## Come funziona

- `muse exec --json` emette record di session-log; il parser (`lib.ts`) usa
  solo `run.terminal.completed` (testo finale + `stream.id` come session id).
- Solo-testo: `--disable-shell --disable-write --disable-web-tools
  --disable-reminders --user-input-auto-resolve`. I tool nativi restano spenti
  perché le approvazioni headless si appendono per sempre (mai più output).
- Contesto: `textTransforms.input` antepone ruolo + `MEMORY.md` + brief
  storico (statico, si aggiorna con reload). `promptChars` nel log è
  pre-transform: non misura il prefisso.
- `ownsNativeCompaction: true` (le sessioni backend sono monouso).

## Limiti noti

- **Niente tool OpenClaw**: serve ponte MCP (progetto a parte). Trovato nello
  spike: `muse exec --disable-approval` toglie il blocco approvazioni; muse
  accetta MCP via stdio e HTTP (`SessionMcpServerConfig`); OpenClaw ha un
  runtime loopback MCP (`mcp-http.loopback-runtime`). Resta da capire:
  endpoint/auth del loopback per backend custom, staging di `settings.json`
  via `prepareExecution`, mapping eventi tool.
- **Usage sempre zero**: i token viaggiano solo nel session-log su disco,
  mai sullo stdout `--json` (verificato: 30 record, zero righe token).
  Irrilevante a subscription flat.
- **Niente voce in `models.providers`**: registrarla chiede API key o fallisce
  (fatale per compaction). Volutamente assente.
- **Immagini**: trasporto `--image` verificato a livello CLI; giro completo
  da allegato canale mai provato (agent CLI non allega).
- **Compaction nativa** su catene resume lunghe mai osservata.
- Ogni verifica con `openclaw agent --session-key` avvelena il resume del
  turno canale dopo (provenance diversa → `invalidated:message-policy`):
  le prove vanno su sessioni usa-e-getta.

## Test

```bash
npm test   # node test/parse.test.mjs, 7 assert su forme reali registrate
```
