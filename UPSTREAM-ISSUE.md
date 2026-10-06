# Upstream issue draft: native `muse-system-settings` bundle MCP mode

File against https://github.com/openclaw/openclaw/issues (feature request).
Branch with a working implementation: `muse-bundle-mcp-mode` in this clone
(kept local until the issue gets maintainer feedback).

---

## Title

Feature: `muse-system-settings` bundle MCP mode for Muse CLI backends

## Problem

File-based CLI backends cannot consume OpenClaw's bundle MCP bridge when the
CLI neither expands `${}` placeholders nor inherits env into MCP servers, and
reads its MCP config from a fixed location. Concretely, the Muse CLI (`muse`):

- reads MCP servers only from `$XDG_CONFIG_HOME/muse/settings.json`,
- sends header values literally (no `${VAR}` expansion),
- scrubs env for stdio MCP servers,
- treats `type: "http"` as stdio (it wants `streamable-http`),
- loses its subscription auth if `auth.json`/`trust.json` are not present.

The loopback capture key only exists at attempt time
(`prepareCliBundleMcpCaptureAttempt`), after `prepareExecution` staging, so a
plugin cannot stage working credentials by itself: it must piggyback the
`gemini-system-settings` mode and re-read core-internal staged files, which
plugins must never do.

Side observation (same area): a single retired/reloaded plugin currently fails
the entire loopback `tools/list` (`request handling failed: Plugin X was
reloaded or disabled`), blinding every MCP backend until a gateway restart.
Skipping the broken plugin instead of failing the whole list would make the
bridge far more robust.

## Proposed solution

A fourth `CliBundleMcpMode`, `muse-system-settings`, following the existing
per-CLI adapter pattern (`bundle-mcp-claude/codex/gemini.ts`):

- prepare: stage a per-turn `XDG_CONFIG_HOME` with `muse/settings.json` =
  real settings merged with translated bundle servers (`http` →
  `streamable-http`, resolved headers, stdio fields dropped on streamable),
  plus `auth.json`/`trust.json`/`skills` symlinked (never copied);
- capture attempt: rewrite the staged `settings.json` in place with the
  capture header (same path, no proxy, no discovery);
- no client-side tool filters (Muse has no include/exclude contract; the
  loopback grant scope keeps enforcing denials server-side).

Backends then only declare `bundleMcp: true` + the mode; no `prepareExecution`
staging and no proxy needed.

## Alternatives considered

- Keep piggybacking `gemini-system-settings` from the plugin: works today
  (see prior art) but reads core-internal staged paths, which violates the
  plugin boundary.
- A generic attempt-time refresh hook for plugins: broader API surface for
  what is, in practice, one more CLI file layout; the per-mode adapter keeps
  the owner (`bundle-mcp`) unchanged.

## Impact / prior art

Working external plugin with the piggyback + a stdio proxy, verified live:
48 host tools listed, real `tools/call` round-trips, resume-safe across
turns, 38 test assertions. The native mode makes that plugin thin and removes
the only core-internal dependency. Happy to open the PR against this issue
once the design is approved.
