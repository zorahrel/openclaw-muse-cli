# openclaw-muse-cli

OpenClaw backend that runs Muse Spark through your local `muse` CLI
login. Community adapter maintained by Attilio Cianci, using OpenClaw's
standard CLI-backend SDK. No API-provider configuration is required.

## Requirements

- `muse` CLI installed and logged in (tested with Muse Code 1.4.3).
- OpenClaw 2026.9.5 or newer. Earlier SDK versions are not supported by this release.
- A Node.js version supported by OpenClaw: 24.16+ on the 24.x line, or 26.1+.

## Install

```bash
curl -fL -o openclaw-muse-cli-0.7.0.tgz \
  https://github.com/zorahrel/openclaw-muse-cli/releases/download/v0.7.0/openclaw-muse-cli-0.7.0.tgz
openclaw plugins install ./openclaw-muse-cli-0.7.0.tgz --force --accept-capabilities
openclaw plugins enable muse-cli --accept-capabilities
openclaw gateway restart
openclaw plugins inspect muse-cli --runtime   # loaded, zero diagnostics
```

Or build a source checkout using Node.js, then link it:

```bash
git clone --branch v0.7.0 https://github.com/zorahrel/openclaw-muse-cli.git
cd openclaw-muse-cli
npm run build
openclaw plugins install --link . --force --accept-capabilities
```

Install or upgrade while the gateway is idle, then restart it. The distribution
is on [GitHub Releases](https://github.com/zorahrel/openclaw-muse-cli/releases);
there is currently no package published as `openclaw-muse-cli` on npm.

When upgrading from 0.5.x, set the per-model thinking parameter shown below.
The old MCP proxy is no longer used; no OpenClaw core patch is needed.

## Configuration

Pick the model (agent default, entry, or existing session override):

```json5
{
  agents: {
    defaults: {
      model: { primary: "muse-cli/muse-spark-1.3" },
      models: { "muse-cli/muse-spark-1.3": { alias: "spark", params: { thinking: "high" } } },
      modelPolicy: { allow: ["muse-cli/*"] }
    }
  }
}
```

Optional plugin config (`plugins.entries.muse-cli.config`). Role and memory
files supplement the full OpenClaw system prompt and are read on each turn.
Use a channel-neutral role: the current channel comes from OpenClaw.

```json5
{
  // Role line. Default: a short generic English assistant prompt.
  role: "You are Friday, the household assistant. Be brief.",
  // Extra files appended after the role (absolute paths).
  memoryFiles: [
    "/home/you/.openclaw/MEMORY.md",
    { path: "/home/you/.openclaw/memory/story.md", chars: 6000, header: "Archive:" }
  ],
  memoryChars: 4000,   // per-file cap when the entry sets none
  separator: "--- Message ---"
}
```

## How it works

- `muse exec --json` emits session-log records; the parser (`lib.ts`) uses
  the terminal record (final text + `stream.id` as session id) and maps
  `tool.result` to a `toolStart`+`toolResult` pair sharing the `call_id`
  (already executed by the backend, never re-run by the host).
- Native tools stay on (shell + write, like `claude-cli` with
  `--dangerously-skip-permissions`); only web tools and reminders are off.
  `--disable-approval` keeps the run non-interactive, so headless approvals
  never hang.
- Uses OpenClaw's standard `registerCliBackend` / `prepareExecution.execute`
  contract. OpenClaw owns turn admission, session queue, prompt construction,
  tool authority, MCP capture, watchdog and history. The command remains `muse`.
- Each turn gets private native settings; auth/trust/skills link to the existing
  subscription configuration. At execution time, the adapter installs the full
  host system prompt as Muse's `run.system_prompt` and consumes the core's
  current MCP attempt settings, translating HTTP transport to Muse's dialect.
  No separate launcher, MCP proxy or invented CLI flags.
- The execution stream preserves Muse records and marks terminal events with
  the SDK's `type:result`; the parser maps the actual final text and tool results.
- Prompt and MCP capture refresh on resume. Different sessions run concurrently
  (`serialize:false`); OpenClaw's session lane still prevents overlap within one.
- The standard manifest model catalog declares reasoning and the supported effort levels.
  Configure per-model `params.thinking: "high"` to keep the native default; an unknown
  CLI model otherwise defaults to off in OpenClaw.
- Explicit OpenClaw thinking levels map to Muse's `--reasoning-effort` (off→minimal, the lowest level accepted by Meta);
  adaptive/unspecified use Muse's native default.
- `ownsNativeCompaction:true`: Muse handles its own compaction.
- `promptChars` in the log is pre-transform: it does not measure the prefix.

## Known limits

- **Promise follow-through**: correct prompt, tools and reasoning transport do
  not guarantee that Muse starts work it promises. Private replay checks still
  reproduced a delayed promise at `max` with zero tool calls or queued/running
  tasks. An explicit request did execute tools and produce a verified artifact.
  Raising effort alone does not fix autonomous coordination; use concrete tasks
  and verify the output. See the [validation record](VALIDATION.md).
- **Usage always zero**: tokens travel only in the on-disk session log, never
  on `--json` stdout. OpenClaw usage counters therefore do not measure Muse usage.
- **No `models.providers` entry**: registering one asks for an API key or
  fails (fatal for compaction). Deliberately absent.
- **Images**: `--image` transport verified at CLI level; full trip from a
  channel attachment untested (the agent CLI cannot attach).
- **Native resume chains** (`muse` sessions) are the source of truth for
  history; the OpenClaw transcript keeps the final text.

## Test from a source checkout

```bash
npm test   # parser, SDK contract, fresh MCP, system/resume/context/abort
npm pack   # builds the JavaScript runtime and creates the installable archive
```

Release changes are recorded in [CHANGELOG.md](CHANGELOG.md).
