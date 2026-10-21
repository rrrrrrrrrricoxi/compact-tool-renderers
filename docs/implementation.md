# Compact renderer 2 implementation

Authoritative package: rrrrrrrrrricoxi/compact-tool-renderers. The approved scope is recorded in the main task's work/compact-renderer-review-handoff.md. Installed releases are immutable.

## Required outcomes

### Work-strip release 2.4.0 — 2026-10-20

`work-strip.ts` projects native chat children only during rendering, preserves the canonical child list, and exposes projected children to inspection. Pi 1.3.0 native lifecycle hooks attach message identity and distinguish replay from live input. The terminal assistant message must contain visible text before completion metadata can be recorded. Empty terminal responses remain open rather than promoting earlier commentary.

`work-strip-subagents.ts` tracks prompt-owned root runs and their descendants through read-only native status events. Workflow dispatch completion is not child completion. Unknown or omitted known-child status remains unresolved. `work-strip-view.ts` validates display-only completion entries against the current branch and owns the strip's disclosure state. Manual expansion and scrollback take precedence over automatic folding.

Native top-level spacers belong to the next canonical content block. Projection retains them with visible blocks and discards them with hidden blocks; it does not transfer spacing across hidden content. Components that own internal spacing retain it. The compact DDD replacement restores the original custom-message leading spacer locally. This keeps skill and summary boundaries separate without adding gaps to questions, tools, or custom notices.

The companion Pi Statusline change temporarily masks only execution state and elapsed time while the strip owns them. It queries ownership after restore and releases it on disposal; saved preferences and the native Fleet remain unchanged. `scripts/preview-work-strip.mjs` supplies isolated recorded examples and a ten-second synthetic lifecycle playback. All 20 suites passed on Mac and CCC, and the user approved the final terminal spacing and work-strip preview on both hosts on 20 October 2026.

- [x] Separate running actions; group only successful completed actions across no visible conversation boundary.
- [x] Keep errors, cancellation, questions and background launches separate; stock pi-subagents/Fleet remains untouched.
- [x] Bounded group pane with independent inline expansion and keyboard navigation.
- [x] Truthful combined question/answer cards including pending/unavailable/cancelled states.
- [x] Concise permission presentation, exact Details, Allow once/Deny, unchanged policies.
- [x] Collapsed recorded thinking groups across tools, reset at visible replies/questions/errors; bounded expansion and native fallback.
- [x] Display-only prompt-template collapse through public markdown transformer.
- [x] Native /fold selector and typed controls; no model/history mutations.
- [x] Native lifecycle regression coverage: redraw/re-registration, stock component ownership, running-shell timer disposal, toggles, refresh/reload/resume/switch/compaction.
- [x] Unicode/narrow layouts, bounded painting, focus/scroll and native fullscreen input checks. Human terminal appearance acceptance remains below.
- [x] Publish standalone version and pin it in Pi Config; remove competing embedded implementation.
- [x] User accepted the final quiet preview after terminal review; harmless native mosh/tmux checks also passed. Normal installed-session acceptance is tracked separately below.
- [x] Publish config, stage both hosts, guarded activation and actual startup-label checks.

## Current release and acceptance — 2026-10-18

Renderer **2.1.1** (`60d4eb2e3e94faa3266d1362b71bcdcba634d6ea`) is published and active on MacBook and CCC through Pi Config **1.6.4** (`7494a95da507d61a5f870caa6d3ebb6aa22b2692`). Both hosts activated through their deployment guards after the user closed Pi. Active manifests, exact Git lockfile pins, package versions, matching renderer file hashes, and cleared pending updates were verified. Host credentials, package resolutions, and unrelated configuration work remain intact.

All nine native renderer regression suites pass on both machines. Native startup labels, 17 mode selectors, and isolated native `codemode` execution/rendering also pass. The user approved the final preview after refining questions to bold purple headings without a background or rail. Selected answers remain green and inline; native subagents/Fleet remain unchanged.

Live acceptance transcripts on both hosts confirm ordinary writes/reads, a separate expected missing-file failure, native `codemode` with one fulfilled and one rejected nested read, and question option/custom/cancelled outcomes. These execution results were recorded before the final presentation update. After 1.6.4 activation, the user confirmed “Pass on both machines” for recorded question inspection, Esc/editor typing, `/prompt-jump list`, `back`, `end`, and exit/resume. This completes the final live acceptance gate. This user report is distinct from automated test and transcript evidence.

Pi Config's `docs/compact-acceptance.md` contains the current acceptance procedure and results. The task's `work/compact-live-acceptance-2026-10-18.md` retains the chronological evidence and earlier failures. Earlier releases and rejected candidates below are historical; their pending statuses do not describe the current deployment.

## Ownership and interface

Parent owns index.ts, display-mode.ts, package metadata, final integration and releases.
Tool worker owns modern-tools.ts and its supporting panes/adapters/tests, including question cards. Entry point registerModernTools(pi, mode).
Thinking worker owns modern-thinking.ts / prompt display modules and their adapters/tests. Entry point registerModernThinking(pi, mode) and registerModernPrompts(pi, mode).
Permission worker owns permission-presentation.ts plus Pi Config's permission call sites/tests. Entry point registerPermissionPresentation(pi, mode).
Each registration returns a dispose callback. mode has isEnabled(): boolean and onChange(callback): unsubscribe. Modules use current Pi 1.3.0 and must fall back truthfully on incompatible shapes. Tests resolve PI_RUNTIME (runtime folder) or PI_INSTALL_ROOT (agent package), with the current host runtime as default; no fixed Homebrew paths.
No child edits another child's or parent's files without coordination. No live database/model calls, no installed-source edits, and no independent commits or pushes.

## Historical integration evidence (2026-10-18)

- All five standalone native-component suites passed from the packed candidate on MacBook and CCC. The source suite also covers restored native shell backgrounds/padding and unknown-renderer fallback output.
- Pi Config native selector and actual startup-resource checks passed; startup labels are pi-ascend-bridge and pi-compact-renderer, with one copy each and unchanged commands.
- Safety presentation passed 11 paired policy scenarios. Native MCP integration passed with loopback fixtures only (54 MCP requests, 93 fake-model requests). No live database/model calls.
- Pi Config Python suites passed (84 checks, including the migration check). Embedded-to-pinned-package migration and rollback preserve one active package and the retained release.
- The isolated actual Pi TUI opened the permission dialog and denied it without performing an operation. Human visual acceptance in local Herdr and mosh/tmux is pending. Computer-use access to Ghostty was denied by the tool; no alternative app-control mechanism was attempted.
- Pi Config seeds native hidden-thinking only if absent; native Ctrl+T changes remain unowned and survive deploys without drift. Both actual hosts currently have no explicit hideThinkingBlock value.
- Legacy 1.x implementation files are removed from the working tree; Git retains their history. The embedded Pi Config renderer is retired only when the published standalone pin is integrated.

That pre-release integration stage is complete. The current release and completed acceptance evidence are stated above.

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

## Code-mode affordance and question history

The native code-mode collapsed view still showed ten script lines, eight nested calls, and five output lines. The user requested a true collapsed card consistent with other blocks. Code mode remains a separate script execution; its nested calls do not become adjacent top-level successful actions. Expanded content retains native presentation. Question cards now retain readable history only, without duplicate raw argument/result objects. These are display changes; execution, permissions, and stored transcripts are unchanged.

The user then clarified that filled status strips were too visually heavy: the primary goal is to compress flat tool activity. This supersedes the earlier padded/color-filled compact-card requirement. Tool, question, code-mode, and thinking summaries now share a neutral single-line treatment. Expanded content stays indented and bounded; keyboard focus remains highlighted. Native user/skill presentation and noncompact mode stay unchanged.

## Collapsed labels and expanded readability correction

Ordinary successful headings now show the recorded operation without “Completed” or a checkmark; groups say “4 actions.” Interpreter scripts use deterministic labels such as “Run Node.js script.” A literal script filename is retained when it directly follows the interpreter. Long/multiline shell source never becomes the collapsed label. Known OS errors show readable categories such as “Path too long”; unknown shell failures say “Command failed,” with the recorded exit code when present. Exact commands and errors remain in expanded Arguments, Output, and Details.

Expanded ordinary source, structured scalar values, and diffs use native syntax colors. Thinking, Markdown files, and explicitly Markdown-typed text use native Markdown styling in bounded source lines. Ordinary stdout and unknown text stay literal. Code fences and recognized interpreter heredocs retain their language across viewport blocks. Each formatting call receives at most 2,048 source characters; this is bounded formatting rather than full-document Markdown. Multiline tables/paragraph structure and lexer state across long code chunks are limited. That earlier code-mode behavior is superseded in compact mode by the bounded native-style candidate below.

The inert preview includes a long Bash/Node singleton, a separate ENAMETOOLONG failure, four grouped source/diff/Markdown/script actions, and a bold recorded thinking title. These records are synthetic; no scripts run. The readability correction shipped in `v2.0.1`; the new density candidate below requires a separate isolated visual review.

## Content first density candidate — pending visual review

Ordinary actions now stack without blank sibling rows. Expanded actions show useful content immediately; independent inline Details contains exact arguments, nulls, secondary diagnostics, and any standard acknowledgement or known error moved from the main view. Successful native `write` actions show submitted content with path-based syntax colors. Only the full exact `Successfully wrote to ${path}` result is suppressed from that main view. Nonstandard acknowledgements and unknown/custom tool output stay visible. Ordinary known OS diagnostic prefixes can show their code and readable category while Details retains the exact raw error. Warning and truncation indicators remain visible. Question cards keep their readable question/choice/answer/status history, with no generic raw Details. The separate bounded native-style code-mode candidate below supersedes the earlier native-component implementation.

Left/Right and Enter keep their action controls. While inspection owns focus, Tab and Shift+Tab switch the selected action/card target with its Details disclosure; Enter toggles that target. The target has visible native selection styling and a matching footer hint. Mouse Details toggles independently without capturing the editor. Short content remains inline above Details. Long-content Details inspection probes at most one viewport, then anchors with “content above ↑”; Up, an upward wheel at the anchor, or Home returns to primary content. Escape and typing restore primary content before releasing keyboard inspection. Selecting Details for a later action does not traverse earlier expanded output. No letter keys or editor Tab are captured.

The synthetic native preview begins with two writes, two reads, and a separate missing-file failure. Regression coverage checks exact-write matching, source colors, unknown/mixed output, error preservation, independent content/Details, compact scalar fields, explicit nulls, visible keyboard targets, editor return, narrow widths, late metadata getters, and bounded large-content anchors. No recorded message or tool activation changes. This candidate is not a release or activation approval.

## Bounded native-style code mode candidate — pending visual review

The user chose bounded native-style rendering and accepted possible syntax-color differences across long multiline code chunks. Compact code mode now keeps original source/result references and formats visited text in chunks of at most 1,024 source characters. It does not invoke native body construction while compact, split/join full source/output, or flatten an entire native component tree before painting. Each paint advances at most one viewport beyond cached rows. Scrolling visits all source, nested calls and their recorded arguments/errors/durations/costs, output blocks, and secondary metadata. Costs use native display formatting in USD. Recognized result envelopes are omitted only when elapsed/recorded duration remains available; replay without a duration retains the wall-time envelope. Terminal controls appear as visible escape text. Recorded objects stay unchanged.

A guarded once-per-update data-shape pass validates text blocks/call records, indexes nonempty blocks, and computes scalar outcome/count/model-cost aggregates. This pass is O(block count + nested-call count), independent of payload-string length, and is explicitly not bounded painting. Instrumentation counts aggregate entries separately from formatted source characters/calls. Explicit execution update/end revisions handle streaming mutations with unchanged object/array identities. Repaint, clock ticks, and unchanged invalidation reuse aggregates and row caches. Theme token changes, including mutation behind Pi's stable theme proxy, invalidate cached ANSI. Cache memory grows with visited rows; a width/theme/result change restarts that view.

Compact mode owns a small lifecycle clock and transfers start/end times when switching to/from the isolated native owner. Completion/error, mode changes, session switch and shutdown clear its interval. Unsupported argument/result/call shapes and nontext results use stock native presentation and stay out of the compact picker; both fallback directions update immediately. Native-off retains stock presentation and its eager-formatting limit. No execution, model, tool activation, permission, or stored-transcript changes.

Regressions include a 11-million-character script, 20,000 nested calls, giant stdout/errors, 100,000 empty blocks, in-place streaming updates, full-tail/metadata reachability, replay duration, theme changes, Unicode/control safety, independent native-off/fallback behavior, clock cleanup, and editor focus. The new source/preview still requires visual acceptance and an immutable candidate; no release or installed snapshot is changed by this work.

## Decision highlight — renderer 2.1.1

Content-first inspection and bounded `codemode` shipped in renderer 2.1.0 with Pi Config 1.6.3. Both hosts activated that release. The user then approved the Decision highlight mockup: questions need visible emphasis as decision records, without returning to large filled tool blocks.

This release keeps question descriptions and options close together. Recorded selections receive an inline green checkmark; custom answers remain explicit. A bold purple question heading distinguishes the card from ordinary prose. The user refined the design to remove the header background and vertical rail. Questions now use the same gutter and indentation as other actions; only keyboard focus receives a background. Ordinary action and `codemode` headings use a restrained native category color; thinking headings are muted; failure headings remain red. Focus retains its separate selection background. Native user prompts, skill cards, and subagent/Fleet rendering remain unchanged. The exact feature name is `codemode`.

The change affects display only. It does not execute tools, change permissions, rewrite recorded answers, or add model calls. The combined preview was made available on both machines, and the user approved proceeding after the final alignment refinement. Automated native checks passed on both hosts. Publication, guarded activation, and final installed-session acceptance are complete as recorded above. Isolated previews do not activate a release or modify running sessions.


## Subagent transcript unification — renderer 2.2.0

The user requested compact subagent transcript cards after seeing the native Fleet roster in operation. This supersedes the earlier exemption for stock subagent transcript presentation. Fleet and all execution/control behavior remain native. Known tool results and asynchronous notices use the common unfilled, expandable layout with bounded content and exact details. A queued request does not imply delivery or completion. Decision requests remain distinct from ordinary activity.

The custom-message adapter is isolated to Pi 1.3.0 renderer resolution and retains the original renderer for native mode and unsupported shapes. It does not mutate transcript entries or register replacement tools. The preview uses invented records and imports only native presentation helpers, without initializing the subagent runtime. The grouped preview passed terminal visual review on the Mac and CCC on 2026-10-18. Publication and guarded activation follow that approval.


### Subagent grouping revision

The first subagent preview still had one heading per bookkeeping event. The user approved grouping consecutive routine updates and combining a matched decision exchange. Failures and unresolved decisions remain visible separately. Correlation uses recorded identifiers and transcript order, never similar labels or component render order. Exact entries stay unchanged; acknowledgements and technical identifiers remain available under Details. The revised preview adds adjacent worker/scout launches, a status update, a matched exchange, and an unanswered request after a visible reply.

## Guide lookup grouping — 2.2.1

Live acceptance on 19 October 2026 showed three consecutive successful guide calls on both hosts. The runtime-update allowlist omitted guide, so each remained a standalone card. Completed text guide results now form their own consecutive group, separate from runtime activity. Per-action titles use the recorded topic with existing label sanitization; expansion and Details preserve exact result content and arguments. Failed, running, nontext, and visible conversation boundaries remain separate. Replay checks against both private acceptance transcripts confirm one guide heading with three exact topics and no transcript mutation. Native preview checks retain the existing runtime group and decision card. The user approved the terminal preview on both machines on 19 October 2026.
