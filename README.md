# openclaw-muse-cli

OpenClaw backend that runs Muse Spark through your local `muse` CLI
subscription. No API key, no per-token billing: if `muse exec` works on your
machine, this backend works in OpenClaw — with host MCP tools.

## Requirements

- `muse` CLI installed and logged in (`muse` uses your Meta subscription).
- OpenClaw with CLI-backend plugin support (tested on 2026.9.5).

## Install

```bash
openclaw plugins install openclaw-muse-cli --accept-capabilities
openclaw plugins enable muse-cli --accept-capabilities
openclaw plugins inspect muse-cli --runtime   # loaded, zero diagnostics
```

Or from a local checkout:

```bash
openclaw plugins install --link ./openclaw-muse-cli --force --accept-capabilities
```

Never `plugins reload` during an active turn (it fails): reload with the
gateway idle, then restart the gateway (see limits).

## Configuration

Pick the model (agent default, entry, or existing session override):

```json5
{
  agents: {
    defaults: {
      model: { primary: "muse-cli/muse-spark-1.3" },
      models: { "muse-cli/muse-spark-1.3": { alias: "spark" } },
      modelPolicy: { allow: ["muse-cli/*"] }
    }
  }
}
```

Optional plugin config (`plugins.entries.muse-cli.config`). `muse exec` has
no `--system` flag and OpenClaw does not re-inject the system prompt for this
backend, so the plugin prepends a static prefix, rebuilt on every reload:

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
- Native tools stay off (`--disable-shell --disable-write --disable-web-tools
  --disable-reminders --user-input-auto-resolve`): headless approvals would
  hang forever. MCP tools run free via `--disable-approval`, like the other
  backends.
- MCP bridge: `bundleMcp` on the `gemini-system-settings` strategy plus a
  `prepareExecution` hook that stages a per-turn `XDG_CONFIG_HOME` with the
  `openclaw` server behind a stdio proxy (`proxy.mjs`). The loopback capture
  key is minted at execute time, after staging, so only the proxy (a child of
  `muse`) can read the fresh attempt file, matched by the stable turn token
  passed via argv. muse expands no `${}` placeholders and inherits no env into
  stdio servers (probed): there is no shortcut. Once core ships a native
  `muse-system-settings` mode (see `UPSTREAM-ISSUE.md`), the proxy goes away
  and the backend only declares the mode.
- `ownsNativeCompaction: true` (backend sessions are single-use).
- `promptChars` in the log is pre-transform: it does not measure the prefix.

## Known limits

- **Restart the gateway after `plugins reload`** (`launchctl kickstart -k`
  on macOS): reload retires the MCP loopback plugin inventory and `tools/list`
  fails until restart (upstream quirk).
- **Turn token in proxy argv**: visible in `ps` while the turn runs, revoked
  afterwards. Equivalent to the attempt file on disk.
- **Usage always zero**: tokens travel only in the on-disk session log, never
  on `--json` stdout. Irrelevant on a flat subscription.
- **No `models.providers` entry**: registering one asks for an API key or
  fails (fatal for compaction). Deliberately absent.
- **Images**: `--image` transport verified at CLI level; full trip from a
  channel attachment untested (the agent CLI cannot attach).
- **Native resume chains** (`muse` sessions) are the source of truth for
  history; the OpenClaw transcript keeps the final text.

## Test

```bash
npm test   # parse.test.mjs (29) + proxy.test.mjs (9, e2e against a fake MCP server)
```
