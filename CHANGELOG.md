# Changelog

## 0.7.0 — 2026-10-07

Muse turns now receive the full OpenClaw system prompt and fresh MCP capture
settings through the standard `prepareExecution.execute` SDK contract. The old
stdio proxy and static user-message prefix have been removed. No core patch is
required.

- Refresh role, extra memory files, system prompt and MCP settings on every turn,
  including native session resume.
- Preserve native authentication, trust and skills in private per-turn settings.
- Translate HTTP transport into Muse's `streamable-http` dialect after the host
  has issued the current capture grant.
- Normalize native terminal events to the SDK result contract. Non-zero exits
  fail; aborted children are terminated and awaited.
- Keep native shell and file tools enabled. Different sessions run concurrently;
  OpenClaw still serializes turns within one session.
- Declare the model's reasoning capabilities and forward explicit effort levels.
  Set per-model `params.thinking: "high"`; `off` maps to native `minimal` because
  Meta rejects `none`.
- Require OpenClaw 2026.9.5 and its supported Node.js versions. Publish a
  compiled JavaScript archive on GitHub Releases, replacing the unregistered
  npm package command. `npm pack` emits the runtime from TypeScript using
  Node.js's built-in type stripping, with no compiler dependency.

This fixes adapter integration, not the model's general reliability. A private
replay still produced a promise of later work at `max` without starting a task.
An explicit task used five tool calls and delivered a verified JSON artifact.
See [VALIDATION.md](VALIDATION.md) for the scope of the checks.
