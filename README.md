# Pi compact renderer

Display-only action groups, recorded thinking, prompt cards, and permission presentation for Pi 1.3.0. The package does not execute tools, call a model, change approval rules, or rewrite session messages. Collapsing text does not save model tokens.

## Install

Install the published Git package once. Pi Config pins the reviewed commit and installs it under `runtime/node_modules/pi-compact-renderer`; its startup label is `pi-compact-renderer`. Do not also load an older local copy.

This repository is the authoritative source. The npm manifest stays `private: true` to prevent accidental npm publication. Releases use Git tags, beginning with `v2.0.0` for this implementation.

## Display

- Compact tool and thinking summaries use one neutral line instead of filled color blocks. Expanded details use indentation and clear headings. Warnings/errors retain status color; keyboard selection alone fills the active heading or item. Native user messages and skill cards keep their own presentation.
- Running actions remain separate. Only successful completed actions join a group, within visible conversation boundaries.
- Successful group headings use “4 actions”; singleton headings show only the operation. Shell interpreter scripts use labels such as “Run Node.js script,” with a literal script filename when reliably available. Inline source stays in Arguments. Known errors show a short category such as “Path too long”; exact errors stay in Output/Details. Labels describe recorded operations and do not infer a script’s purpose.
- Expanded source and diffs use Pi’s syntax colors. Recorded thinking and Markdown files use bounded Markdown rendering; shell stdout and unknown text remain literal. Formatting reads at most 2,048 source characters per block. Markdown uses one source line per block, so multiline tables, paragraphs, and cross-line inline formatting are not fully reconstructed. Very long code blocks can lose lexer context at block boundaries. The original recorded source remains unchanged.
- A single-action card opens directly to useful content without repeating a numbered action row. Successful native `write` actions show submitted content with syntax colors from the path. Only the exact standard acknowledgement is moved under Details. Reads and unknown tools keep their output visible. Known ordinary-tool OS diagnostics can show a short code/category while Details retains the exact error; unknown/custom failures keep full visible output. Status marks follow the title.
- Open a group to see tightly stacked actions without blank rows between siblings. Several actions and their inline Details can remain expanded independently in the same scrollable pane. Details contains exact arguments, secondary diagnostics, and any acknowledgement/error moved from the main content. Short scalar fields share a line; null and empty values remain explicit. Empty diagnostic objects do not add a section.
- Errors, cancellations, unanswered questions, and background notices stay separate. Question cards retain the question, context, choices, and recorded answer or actual status. They omit duplicate raw Arguments/Details objects; stored transcripts retain the original data.
- Stock `pi-subagents` and Fleet UI renderers remain unchanged. Code mode has its own collapsible card, separate from consecutive successful actions. Its expanded body uses bounded chunks with native JavaScript colors, nested-call status colors, durations, and model cost in USD. Source, recorded call arguments/errors, output, and metadata remain scroll-accessible. Long multiline code can have different syntax colors across chunk boundaries. Shape validation and scalar call/count/cost aggregation run once per explicit update revision; they are separate from bounded viewport painting. Unsupported shapes/nontext results and compact mode off retain the stock native renderer. Images retain their native display behavior.
- Recorded thinking rounds can group across tools. Replies, questions, errors, and other visible boundaries separate groups. Each round has a short title taken from its recorded heading or first sentence and expands independently. The pane shows the full recorded text on demand; it does not generate summaries or make model calls.
- Recognized prompt templates show their command and authored description, or a bounded excerpt when no description is available. Expansion reveals the original text inline. Ordinary user messages stay open. Skill invocations are a separate native Pi component: the purple `[skill] name` card retains click/Ctrl+O expansion.

Thinking groups require Pi's native `hideThinkingBlock: true` preference. Pi Config seeds this preference only when absent, then preserves native changes. **Ctrl+T** still switches to Pi's full thinking display. Unsupported Pi versions or component shapes show native content instead of hiding it.

## Controls

`/compact-rendering` opens a native selector. Typed `on`, `off`, `toggle`, and `status` remain available. This display mode is session-local and starts enabled.

`/inspect` opens a native picker for tool groups, thinking groups, and prompt cards. Selection brings the block into view, highlights its header and selected item, and shows an inspection status in the footer.

| Surface | Controls after selection |
| --- | --- |
| Tool groups | For a single action, Enter opens/closes the card. For groups, Left/Right selects an action and Enter opens/closes its content. Tab or Shift+Tab switches between the selected action and its Details; Enter toggles that target. Up/Down scroll; Home returns to the first action. |
| Thinking | Left/Right selects a round; Enter opens/closes its recorded text; Up/Down scroll; Home returns to the first round. Ctrl+T retains native visibility control. |
| Prompt cards | Enter opens/closes the original text. |
| Permission | Up/Down chooses Allow once, Deny, or Details; Enter selects; `d` toggles Details; Esc denies. Deny is selected initially. With Details open, Left/Right pages and Home/End jumps. |

Esc returns to the editor. Typing, pasting, or using an editor key also releases inspection; the next Enter submits normally. Clicking or scrolling a card changes its display without taking keyboard focus. Compact activity keeps a one-cell gutter without filled backgrounds or top/bottom padding. Expanded ordinary actions show useful content with exact arguments and secondary data under inline Details; questions use readable history only; unfocused cards omit repeated control/count footers.

Alt+G, Alt+T, and Alt+I remain optional shortcuts for tools, thinking, and prompts when the terminal sends Alt key sequences. On macOS, Option may instead type characters. Those characters remain ordinary input; use `/inspect` without changing terminal settings.

Mouse controls support tool and thinking headers, individual action and Details expansion, wheel scrolling inside open panes, and prompt headers. Short content stays above Details. For long content, Details inspection uses a bounded viewport anchor with “content above ↑”; Up, scrolling upward at that anchor, or Home returns to content. Escape or typing releases keyboard inspection and restores the content view. Tab remains native in the editor. Terminal mouse support depends on the terminal and transport. Keyboard controls remain available over mosh/tmux. Detailed keyboard hints appear on the focused pane. Arrows are captured only while a pane has focus. In fullscreen Pi, PageUp/PageDown scroll the transcript before extension controls receive them; use the arrows shown above for pane content. Opening a native question or approval releases transcript focus.

## Permission presentation seam

A caller that already decided approval is required may emit `pi:permission-presentation:v1` with `{version:1, mode:'tui', action, target, reason, details, ui, signal?, offer}`. The first synchronous `offer(() => Promise<boolean>)` wins. The caller invokes that presenter once; absent presenters use the caller's native fallback. A claimed dialog failure or cancellation denies without opening a second prompt.

The renderer presents the caller's action, target, reason, and exact Details. Large fields have explicit shortened summaries and lazy Details navigation. Policies stay in the safety/MCP callers. Print/RPC and incompatible UI contexts keep the caller's fallback. Ordinary read approvals are not added here.

## Verification and preview

Use Node and a Pi 1.3.0 runtime:

```sh
PI_RUNTIME=/path/to/runtime node test.mjs
PI_RUNTIME=/path/to/runtime node preview.mjs
```

The runtime directory contains `node_modules/@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. The default is `~/.local/state/pi-config/current/runtime`. Tests use actual native components and isolated fixtures. Coverage includes repeated synchronous redraw, separate native component caches, shell timer cleanup, status transitions, lifecycle changes, stock subagent rendering, Unicode, narrow widths, and bounded work on large outputs. No model or database calls are needed.

The preview runs the actual Pi TUI with invented recorded messages in a temporary home. It blocks model, shell, tool, and network requests. The fixture begins with two writes, two reads, and a separate missing-file error. It also includes a long ordinary Bash/Node script singleton, a separate long-path failure, and four grouped source/diff/Markdown/script actions. Code mode uses bounded native-style JavaScript highlighting, nested calls, timing, and cost display; every recorded call and price is synthetic. Ctrl+O expands code-mode and native skill cards. `/fixture-permission` opens an inert approval example. `/fixture-question` opens the installed pi-questions choice UI; `/fixture-question text` opens its free-text UI. Answers perform no operation. The question UI uses the current Pi Config package by default; set `PI_QUESTIONS_PATH=/path/to/pi-questions/index.ts` to use another source. If unavailable, the preview reports that limit and still shows recorded question cards.

The preview does not load host credentials or change active Pi deployments. Use Ctrl+D to exit. Set `PI_PROMPT_JUMP_PATH=/path/to/pi-prompt-jump` to include the separate navigation package and inspect its behavior with the three invented user prompts.

The adapters for thinking, prompt component identity, viewport positioning, and native shell timers are isolated and gated to Pi 1.3.0. Future versions require review; passing these tests does not certify a different runtime or every terminal. Legacy 1.x implementation and development history remain in Git rather than as a second shipped renderer.

## License

[MIT](LICENSE).
