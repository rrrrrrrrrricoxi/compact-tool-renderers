# Pi compact renderer

Less scrolling. More room for the answer.

A Pi extension that keeps progress visible while the agent works, then folds the steps into a **Worked for …** strip. The final reply stays in view, and you can expand the strip whenever you want the details.

- **Follow the work.** Tool calls, thinking, and subagent updates stay organized under each prompt.
- **Find the answer.** Final replies get a subtle background. Questions, decisions, and unresolved errors remain visible when work is folded.
- **Open what you need.** Inspect tool output, code, diffs, and recorded images. Long prompts and skill text fold too.

Replies without tool or subagent activity skip the work strip.

## Install

Tested with **Pi 1.3.0** and **Node.js 22.19.0 or later**. Other Pi versions are not verified; version-sensitive features fall back to native rendering.

```sh
pi install npm:pi-compact-renderer@2.5.2
```

Restart Pi, or run `/reload` when the session and its background work are idle.

If Pi Config already manages your renderer, update through Pi Config. You do not need a second copy.

## Everyday controls

| To… | Use… |
| --- | --- |
| Open a block | Click its arrow, or use `/inspect` |
| Return to typing | Esc |
| Collapse work sections | `/work collapse` or Ctrl+Alt+W |
| Expand work sections | `/work expand` |
| Turn compact rendering off | `/compact-rendering off` |

Active and waiting work stays open. To disable the collapse shortcut, use `/work shortcut off`.

## A few things to know

This changes the transcript's appearance. It preserves the original messages and does not reduce token usage or make extra model calls.

Image previews depend on your terminal. When images cannot display, you get a text fallback. Keyboard inspection works over mosh/tmux.

Compact thinking groups need Pi's `hideThinkingBlock: true` setting. Ctrl+T still switches to Pi's full thinking display. Compatibility with other transcript-rendering extensions has not been verified.

For detailed behavior, all keyboard controls, and test/preview instructions, see the [renderer reference](https://github.com/rrrrrrrrrricoxi/compact-tool-renderers/blob/main/docs/renderer-reference.md).

## Performance

In a synthetic 400-turn transcript, median warm layout took **4.9 ms on Mac and 3.3 ms on CCC**, down from 12.6 and 9.5 ms. Added layout time versus compact rendering disabled was **4.6 ms and 3.1 ms**; retained fixture memory increased by about **0.14 MiB** versus the prior renderer.

Measured with Pi 1.3.0, Node 26.11.1, and a 100-column layout. These are layout benchmarks, not live typing or terminal latency. See [methods, cache limits, and results](https://github.com/rrrrrrrrrricoxi/compact-tool-renderers/blob/main/PERFORMANCE.md).

## Uninstall

```sh
pi remove npm:pi-compact-renderer@2.5.2
```

[MIT license](LICENSE) · [Report an issue](https://github.com/rrrrrrrrrricoxi/compact-tool-renderers/issues)
