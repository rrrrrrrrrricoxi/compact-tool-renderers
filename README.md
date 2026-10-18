# Pi compact renderer

Display-only action groups, recorded thinking, prompt cards, and permission presentation for Pi 1.3.0. The package does not execute tools, call a model, change approval rules, or rewrite session messages. Collapsing text does not save model tokens.

## Install

Install the published Git package once. Pi Config pins the reviewed commit and installs it under `runtime/node_modules/pi-compact-renderer`; its startup label is `pi-compact-renderer`. Do not also load an older local copy.

This repository is the authoritative source. The npm manifest stays `private: true` to prevent accidental npm publication. Releases use Git tags, beginning with `v2.0.0` for this implementation.

## Display

- Cards restore the original renderer’s native backgrounds and horizontal padding: successful tools, running actions, and failures use their native status colors. Questions use the user-message surface; recorded thinking uses the custom-message surface with readable body text.
- Running actions remain separate. Only successful completed actions join a group, within visible conversation boundaries.
- Open a group to see its actions. Expand several action outputs independently in the same scrollable pane. Exact arguments, recorded output, and recorded details remain available.
- Errors, cancellations, unanswered questions, and background notices stay separate. Question cards combine the question and its recorded answer or actual status.
- Stock `pi-subagents`, Fleet UI, and code mode renderers remain unchanged. Code mode keeps native JavaScript highlighting, nested calls, timing, cost, and Ctrl+O expansion. Images retain their native display behavior.
- Recorded thinking rounds can group across tools. Replies, questions, errors, and other visible boundaries separate groups. Each round has a short title taken from its recorded heading or first sentence and expands independently. The pane shows the full recorded text on demand; it does not generate summaries or make model calls.
- Recognized prompt templates show a short label. Expansion reveals the original text inline. Ordinary user messages and native skill blocks retain their normal rendering.

Thinking groups require Pi's native `hideThinkingBlock: true` preference. Pi Config seeds this preference only when absent, then preserves native changes. **Ctrl+T** still switches to Pi's full thinking display. Unsupported Pi versions or component shapes show native content instead of hiding it.

## Controls

`/compact-rendering` opens a native selector. Typed `on`, `off`, `toggle`, and `status` remain available. This display mode is session-local and starts enabled.

`/inspect` opens a native picker for tool groups, thinking groups, and prompt cards. Selection brings the block into view, highlights its header and selected item, and shows an inspection status in the footer.

| Surface | Controls after selection |
| --- | --- |
| Tool groups | Left/Right selects an action; Enter opens/closes its output; Up/Down scroll; Home returns to the first action. |
| Thinking | Left/Right selects a round; Enter opens/closes its recorded text; Up/Down scroll; Home returns to the first round. Ctrl+T retains native visibility control. |
| Prompt cards | Enter opens/closes the original text. |
| Permission | Up/Down chooses Allow once, Deny, or Details; Enter selects; `d` toggles Details; Esc denies. Deny is selected initially. With Details open, Left/Right pages and Home/End jumps. |

Esc returns to the editor. Typing, pasting, or using an editor key also releases inspection; the next Enter submits normally. Clicking or scrolling a card changes its display without taking keyboard focus. Cards keep Pi’s native one-cell gutter and top/bottom padding. Expanded actions show output first, followed by exact arguments and details; unfocused cards omit repeated control/count footers.

Alt+G, Alt+T, and Alt+I remain optional shortcuts for tools, thinking, and prompts when the terminal sends Alt key sequences. On macOS, Option may instead type characters. Those characters remain ordinary input; use `/inspect` without changing terminal settings.

Mouse controls support tool and thinking headers, individual action expansion, wheel scrolling inside open panes, and prompt headers. Terminal mouse support depends on the terminal and transport. Keyboard controls remain available over mosh/tmux. Detailed keyboard hints appear on the focused pane. Arrows are captured only while a pane has focus. In fullscreen Pi, PageUp/PageDown scroll the transcript before extension controls receive them; use the arrows shown above for pane content. Opening a native question or approval releases transcript focus.

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

The preview runs the actual Pi TUI with invented recorded messages in a temporary home. It blocks model, shell, tool, and network requests. `/fixture-permission` opens an inert approval example. The preview does not load host credentials or change active Pi deployments. Use Ctrl+D to exit. Set `PI_PROMPT_JUMP_PATH=/path/to/pi-prompt-jump` to include the separate navigation package and inspect its behavior with the three invented user prompts.

The adapters for thinking, prompt component identity, viewport positioning, and native shell timers are isolated and gated to Pi 1.3.0. Future versions require review; passing these tests does not certify a different runtime or every terminal. Legacy 1.x implementation and development history remain in Git rather than as a second shipped renderer.

## License

[MIT](LICENSE).
