# Compact renderer 2 implementation

Authoritative package: rrrrrrrrrricoxi/compact-tool-renderers. The approved scope is recorded in the main task's work/compact-renderer-review-handoff.md. Installed releases are immutable.

## Required outcomes

- [x] Separate running actions; group only successful completed actions across no visible conversation boundary.
- [x] Keep errors, cancellation, questions and background launches separate; stock pi-subagents/Fleet remains untouched.
- [x] Bounded group pane with independent inline expansion and keyboard navigation.
- [x] Truthful combined question/answer cards including pending/unavailable/cancelled states.
- [x] Concise permission presentation, exact Details, Allow once/Deny, unchanged policies.
- [x] Collapsed recorded thinking groups across tools, reset at visible replies/questions/errors; bounded expansion and native fallback.
- [x] Display-only prompt-template collapse through public markdown transformer.
- [x] Native /compact-rendering selector and typed controls; no model/history mutations.
- [x] Native lifecycle regression coverage: redraw/re-registration, stock component ownership, running-shell timer disposal, toggles, refresh/reload/resume/switch/compaction.
- [ ] Unicode/narrow layouts, bounded painting, focus/scroll/keyboard terminal checks.
- [ ] Publish standalone version and pin it in Pi Config; remove competing embedded implementation.
- [ ] User visual acceptance in local Herdr and mosh/tmux CCC with harmless fixtures.
- [ ] Publish config, stage both hosts, guarded activation and actual startup-label checks.

## Ownership and interface

Parent owns index.ts, display-mode.ts, package metadata, final integration and releases.
Tool worker owns modern-tools.ts and its supporting panes/adapters/tests, including question cards. Entry point registerModernTools(pi, mode).
Thinking worker owns modern-thinking.ts / prompt display modules and their adapters/tests. Entry point registerModernThinking(pi, mode) and registerModernPrompts(pi, mode).
Permission worker owns permission-presentation.ts plus Pi Config's permission call sites/tests. Entry point registerPermissionPresentation(pi, mode).
Each registration returns a dispose callback. mode has isEnabled(): boolean and onChange(callback): unsubscribe. Modules use current Pi 1.3.0 and must fall back truthfully on incompatible shapes. Tests resolve PI_RUNTIME (runtime folder) or PI_INSTALL_ROOT (agent package), with the current host runtime as default; no fixed Homebrew paths.
No child edits another child's or parent's files without coordination. No live database/model calls, no installed-source edits, and no independent commits or pushes.

## Integration evidence (2026-10-18)

- All five standalone native-component suites passed from the packed candidate on MacBook and CCC. The source suite also covers restored native shell backgrounds/padding and unknown-renderer fallback output.
- Pi Config native selector and actual startup-resource checks passed; startup labels are pi-ascend-bridge and pi-compact-renderer, with one copy each and unchanged commands.
- Safety presentation passed 11 paired policy scenarios. Native MCP integration passed with loopback fixtures only (54 MCP requests, 93 fake-model requests). No live database/model calls.
- Pi Config Python suites passed (84 checks, including the migration check). Embedded-to-pinned-package migration and rollback preserve one active package and the retained release.
- The isolated actual Pi TUI opened the permission dialog and denied it without performing an operation. Human visual acceptance in local Herdr and mosh/tmux is pending. Computer-use access to Ghostty was denied by the tool; no alternative app-control mechanism was attempted.
- Pi Config seeds native hidden-thinking only if absent; native Ctrl+T changes remain unowned and survive deploys without drift. Both actual hosts currently have no explicit hideThinkingBlock value.
- Legacy 1.x implementation files are removed from the working tree; Git retains their history. The embedded Pi Config renderer is retired only when the published standalone pin is integrated.

No renderer release is published or activated yet. Package metadata targets 2.0.0; Pi Config release integration remains pending after visual acceptance.

Final source review also verified native-off ANSI/background/padding parity and bounded preceding-page navigation after End in permission Details. The only review findings were fixed before freezing the next candidate.
