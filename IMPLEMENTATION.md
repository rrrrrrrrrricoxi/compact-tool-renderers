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
- [x] Unicode/narrow layouts, bounded painting, focus/scroll and native fullscreen input checks. Human terminal appearance acceptance remains below.
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

Final source review also verified native-off ANSI/background/padding parity and bounded preceding-page navigation after End in permission Details. A subsequent real mosh/tmux check exposed Pi fullscreen capturing PageUp/PageDown before extension input. Permission Details now advertises Left/Right paging; a native TuiAltScreen/InteractiveMode input regression verifies paging, unchanged background position, option selection, denial, and editor restoration. Transcript pane hints use their working Up/Down controls.

## Visual correction after user preview

The user’s Herdr screenshot rejected the unshaded tool groups and low-contrast thinking. Visual acceptance has not passed. Restore the original renderer’s full-width native backgrounds and padding, distinguish question/thinking cards, and reduce unfocused control clutter. Verify actual ANSI color coverage, narrow widths, focus and mouse coordinates before preparing a fresh immutable preview. Include the separately tracked Prompt Jump package after Pi 1.3 compatibility checks.

## Native spacing and editor-focus correction

The next user screenshot showed one-line colored strips, inconsistent expanded alignment, and Enter blocking prompt submission. Native Pi uses `Box(1, 1)` for tool blocks. Compact tool/thinking surfaces now preserve that top/bottom padding and native horizontal gutter; nested action/output indentation is explicit and wrapping uses the remaining width. Mouse hit coordinates include the padding.

The input defect came from terminal listeners retaining inspection focus after forwarding typing to the editor; mouse expansion also acquired keyboard focus. Only explicit inspection shortcuts now acquire keyboard focus. Unhandled editing input releases inspection before reaching the native editor; mouse expansion releases keyboard inspection. Ordinary `c` and Space are no longer inspector commands. The new input-focus suite exercises real native Editor typing, paste, Backspace and submission through all three extension listeners. No model/tool/history behavior changes.

Visual acceptance remains pending for this correction. Prior rejected candidates are not release approval.

## Inspection and hierarchy correction

The user reported unclear focus and Option shortcuts typing characters on macOS. `/inspect` now selects through Pi's native picker, highlights the header and selected item, reveals the chosen block, and sets a short native footer status. The viewport adapter is version/shape guarded to Pi 1.3.0; it reads the mounted layout and scrolls the existing primary ScrollView without replacing Prompt Jump's root. Escape or editing releases focus. No Option characters are intercepted.

Expanded actions show output before exact arguments/details, with distinct headings and no repeated unfocused count footer. Thinking groups use independently expandable rounds with bounded titles extracted from recorded text. Code mode retains the original native renderer and nested-call display. Native picker/viewport and native code-mode suites join the six existing suites. Actual local PTY checks cover offscreen selection, visible focus, output expansion and editor restoration. Visual acceptance and publication remain pending.

## Singleton and preview clarification

The next screenshot identified duplicate single-action headings, status-prefix misalignment, terse template labels, and question/user surface ambiguity. Single actions now expand directly, status marks follow title text, and question cards use the native neutral tool surface. Prompt templates show existing descriptions or bounded recorded excerpts. Actual native skill cards remain separate and unchanged. The isolated preview includes native code mode and skill rendering plus detailed recorded question states; no examples execute scripts, services, or models. Visual acceptance is still pending.
