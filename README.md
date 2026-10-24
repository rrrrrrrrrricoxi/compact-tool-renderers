# Pi Fold

Follow the work. Unfold the details.

A Pi extension that keeps progress visible while the agent works, then folds the steps into a **Worked for …** strip. The final reply stays in view, and you can expand the strip whenever you want the details.

- **Follow the work.** Tool calls, thinking, and subagent updates stay organized under each prompt.
- **Find the answer.** Final replies get a subtle background. Questions, decisions, and unresolved errors remain visible when work is folded.
- **Open what you need.** Inspect tool output, code, diffs, and recorded images. Long prompts and skill text fold too.

Replies without tool or subagent activity skip the work strip.

## Install

Tested with **Pi 1.3.0 and 1.4.0**, and **Node.js 22.19.0 or later**. Fold checks each feature’s required interfaces, so compatible newer Pi releases can work without a Fold update. Run `/fold status` for full, partial, or unavailable support. Missing interfaces use native rendering. [Compatibility checks](docs/compatibility-testing.md) run against Pi 1.3.0 and the latest stable release.

```sh
pi install npm:@notrico/pi-fold@3.0.5
```

Restart Pi, or run `/reload` when the session and its background work are idle.

If a configuration manager already installs this extension, update it there to avoid duplicate copies.

## Everyday controls

| To… | Use… |
| --- | --- |
| Open the Pi Fold menu | `/fold` |
| Enable Pi Fold | `/fold on` |
| Open a block | Click its arrow, or use `/inspect` |
| Return to typing | Esc |
| Toggle completed work sections | Ctrl+Alt+W |
| Collapse work sections | `/fold collapse` |
| Expand work sections | `/fold expand` |
| Show native Pi rendering | `/fold off` |

Use `/fold status` to check the mode. `/fold toggle` switches between Pi Fold and native display.

Ctrl+Alt+W collapses completed work if any section or retained detail pane is expanded; otherwise it expands completed work. Collapse also closes manually opened actions and details. After collapse, expanding a work section starts with its detail panes closed. Active and waiting sections stay unchanged by collapse and the shortcut. To disable the shortcut, use `/fold shortcut off`.

Upgrading from `pi-compact-renderer`? Remove its existing install source before installing `@notrico/pi-fold` so Pi loads one copy. Version 3 replaces `/compact-rendering` and `/work` with `/fold`; the old commands are removed.

## A few things to know

This changes the transcript's appearance. It preserves the original messages and does not reduce token usage or make extra model calls.

Image previews depend on your terminal. When images cannot display, you get a text fallback. Keyboard inspection works over mosh/tmux.

Compact thinking groups need Pi's `hideThinkingBlock: true` setting. Ctrl+T still switches to Pi's full thinking display. Compatibility with other transcript-rendering extensions has not been verified.

For detailed behavior, all keyboard controls, and test/preview instructions, see the [renderer reference](https://github.com/rrrrrrrrrricoxi/pi-fold/blob/main/docs/renderer-reference.md).

## Performance

Across two benchmark machines, median warm layout for a synthetic 400-turn transcript fell from **9.5–12.6 ms to 3.3–4.9 ms**. Added layout time versus compact rendering disabled was **3.1–4.6 ms**; retained fixture memory increased by about **0.14 MiB** versus the prior renderer.

Measured on macOS arm64 with Pi 1.3.0, Node 26.11.1, and a 100-column layout. These are layout benchmarks, not live typing or terminal latency. See [methods, cache limits, and results](https://github.com/rrrrrrrrrricoxi/pi-fold/blob/main/docs/performance.md).

## Development

Runtime modules live in `src/`, regression checks in `tests/`, preview and benchmark runners in `scripts/`, and detailed notes in `docs/`. `index.ts` is the Pi entry point.

Run `npm test`, `npm run preview:work`, or `npm run benchmark`. See the [renderer reference](docs/renderer-reference.md) for runtime setup.

## Uninstall

```sh
pi remove npm:@notrico/pi-fold@3.0.5
```

[MIT license](LICENSE) · [Report an issue](https://github.com/rrrrrrrrrricoxi/pi-fold/issues)
