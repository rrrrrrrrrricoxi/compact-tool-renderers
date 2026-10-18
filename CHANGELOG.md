# Release notes

## 2.1.2 — Distinct codemode labels

- Use native teal for the `codemode` label, with muted nested-call counts and timing. Keep ordinary action headings blue.
- Keep failed scripts red and handled nested problems in warning color. Preserve expansion, focus, native syntax colors, and exact records.
- Retain factual count-based summaries when the recorded call has no intention metadata. No extra model calls or inferred script descriptions.

## 2.1.1 — Clear question history and output categories

- Highlight recorded answers inline with their options and tighten question spacing. Preserve custom answers and meaningful diagnostics without duplicate Answer sections.
- Use bold purple question headings aligned with other actions, without a background or vertical rail. Keep green selected answers, blue ordinary action/`codemode` headings, muted thinking, and red failures.
- Preserve distinct keyboard focus, native subagent/Fleet rendering, exact transcripts, bounded inspection, and existing controls.
- Use Pi's `codemode` spelling in current documentation and preview text.

## 2.1.0 — Content-first inspection and bounded code mode

- Show useful action content first, keep exact arguments under independently expandable Details, and remove gaps between sibling actions. Preserve readable question history.
- Render supported code-mode scripts, nested calls, errors, output, timing, and costs incrementally as the user scrolls. Retain all recorded content and metadata.
- Preserve editor return, native-off display, and fallback for unsupported result shapes. Handle streaming updates, theme changes, and timer cleanup.
- Aggregate result blocks/calls once per update; cache visited rows. Long multiline syntax colors can differ at chunk boundaries.
- Verify the combined preview in local Herdr and CCC over mosh/tmux before publication.

## 2.0.1 — Readable inspection and concise summaries

- Show compact operation labels for embedded scripts and short failure categories. Keep exact commands and errors in expanded details.
- Label groups as `N actions` and omit redundant success labels, including code mode.
- Restore native syntax colors for expanded source, commands, and diffs. Format Markdown files and recorded thinking while keeping shell output literal.
- Keep formatting work bounded to visited content and preserve transcript data, focus controls, and separate native code-mode inspection.

## 2.0.0 — Compact activity for Pi 1.3.0

- Group consecutive successful completed calls behind neutral one-line summaries. Running calls, failures, questions, and background notices remain separate.
- Expand individual actions inline with bounded scrolling. Single actions open directly to their output; questions retain readable question, choices, answer, and status without raw object dumps.
- Give code mode a separate collapsible summary with script outcome and nested-call status. Preserve native highlighted code, results, timing, and cost inside the expanded viewport.
- Group recorded thinking into independently expandable rounds. Collapse recognized prompt templates with descriptions or excerpts; retain the original text on expansion.
- Add `/inspect` with a native picker, visible focus, and viewport reveal. Typing or Escape returns control to the editor; mouse expansion does not capture prompt submission. Keep `/compact-rendering` and retire legacy `/blocks`.
- Preserve stock pi-subagents/Fleet UI, native images, stored messages, model inputs, and execution policy.
- Add a permission presentation interface with concise summaries, exact lazy Details, and a single approval decision. Caller approval policies remain unchanged.
- Fix synchronous redraw loops, native component cache reuse, shell timer cleanup, and misleading completion labels.
- Replace Pi 1.1 adapters with guarded Pi 1.3 integration, native regression suites, and an isolated preview with no model, shell, or database execution.

Expanded code-mode content uses native formatting internally; its visible viewport is bounded. Native compatibility guards fall back to stock display on unsupported shapes.

## 1.19.3

Previous Pi 1.1 implementation. Its source and release history remain available in Git.
