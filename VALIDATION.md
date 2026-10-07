# Validation — 0.7.0

Checked on 2026-10-07 with OpenClaw/plugin SDK 2026.9.5, Muse Code
1.4.3-R5018.1, and Node.js 26.9.0 on macOS. Private channel content,
credentials and raw native logs are not included in the release.

## Automated checks

`npm test` builds the JavaScript runtime, then runs parser, backend-argument
and SDK-execution checks against the emitted backend. Execution
fixtures verify fresh system prompts and MCP capture headers, native resume
arguments, preserved host prompt context, unchanged real settings, tool result
parsing, non-zero exits, spawn errors and abort cleanup for a child that ignores
SIGTERM. The suite does not call an inference provider.

`npm pack` emits JavaScript entrypoints from the TypeScript sources. The archive
is checked for `index.js`, `setup-api.js`, `lib.js`, the manifest and `execution.mjs`.
The archive is installed and inspected with an isolated OpenClaw state/config
directory, so release checks do not replace the live adapter or use model quota.

## Live checks completed during the repair

| Check | Observed result |
| --- | --- |
| Host MCP access | `sessions_list` succeeded, one call, zero errors, 12.862 s |
| Conditional silence | `NO_REPLY` when the final answer was already delivered, 9.257 s |
| Concurrent sessions | A second session finished 5.568 s before the first session's 25 s wait ended |
| Native resume and history | Same native session reused; history read and local file written, two calls, zero errors; quoted source checked against the canonical transcript |
| Channel and system context | `channel=discord` in native runtime context; full system prompt present, 58,512 characters; no fixed WhatsApp role |

These runs were private: no external message delivery or project modification.
The live checks are reported measurements, not checks run by `npm test`.

## Model behavior remains a separate limit

A concrete read-only request at `max` read recent channel history, separated
verified facts from unfinished checks, and wrote a local JSON artifact. It
completed in 92.268 s with five tool calls and zero errors. The file existed,
parsed as JSON, and its quoted customer message matched the original transcript.

A replay of a conversational mention with the normal assistant profile at `max`
instead promised to wait and finish checks later. It completed in 92.636 s with
zero tool calls; the task ledger contained zero queued/running tasks afterward.
The read-only replay did not authorize starting external jobs, but its reply
still promised a continuation it had not arranged.

The adapter can transport context and execute tools. These checks do not
establish reliable autonomous coordination, and increasing effort alone did not
remove the empty promise. No semantic retry, promise detector or model-specific
follow-up loop has been added to the adapter.
