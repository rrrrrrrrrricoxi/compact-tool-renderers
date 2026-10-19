import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createDisplayMode } from './display-mode.ts';
import { registerModernTools } from './modern-tools.ts';
import { registerModernThinking } from './modern-thinking.ts';
import { registerModernPrompts } from './modern-prompts.ts';
import { registerModernWorkflows } from './modern-workflows.ts';
import { registerModernSubagentMessages } from './modern-subagent-messages.ts';
import { registerInspection } from './inspection.ts';
import { registerPermissionPresentation } from './permission-presentation.ts';
import { registerWorkStrip } from './work-strip.ts';

export default function compactRenderer(pi: ExtensionAPI): void {
  const mode = createDisplayMode();
  const disposers: Array<() => void> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of [...disposers].reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    mode.dispose();
    if (errors.length) throw new AggregateError(errors, 'Compact renderer cleanup failed');
  };
  try {
    disposers.push(registerModernTools(pi, mode));
    disposers.push(registerModernThinking(pi, mode));
    disposers.push(registerModernPrompts(pi, mode));
    disposers.push(registerModernWorkflows(pi, mode));
    disposers.push(registerPermissionPresentation(pi, mode));
    disposers.push(registerModernSubagentMessages(pi, mode));
    disposers.push(registerWorkStrip(pi, mode));
    disposers.push(registerInspection(pi, mode));
  } catch (error) {
    dispose();
    throw error;
  }
  pi.on('session_shutdown', dispose);
  pi.registerCommand('compact-rendering', {
    description: 'Choose compact display or set on/off/toggle/status',
    async handler(args, ctx) {
      let choice = args.trim().toLowerCase();
      if (!choice && ctx.hasUI) {
        const current = mode.isEnabled() ? 'on' : 'off';
        const other = current === 'on' ? 'off' : 'on';
        const choices = [current, other].map(value => `${value}${value === current ? ' (current)' : ''} — ${value === 'on' ? 'group completed actions and recorded thinking; expand inline' : 'native display'}`);
        const selected = await ctx.ui.select('Compact rendering — this session', choices);
        if (selected === undefined || selected === choices[0]) return;
        if (selected !== choices[1]) return;
        choice = other;
      }
      if (!['', 'status', 'on', 'off', 'toggle'].includes(choice)) {
        ctx.ui.notify('Use /compact-rendering [on|off|toggle|status]', 'info');
        return;
      }
      if (choice === 'on' || choice === 'off' || choice === 'toggle') {
        mode.setEnabled(choice === 'toggle' ? !mode.isEnabled() : choice === 'on');
      }
      ctx.ui.notify(`Compact rendering ${mode.isEnabled() ? 'on' : 'off'}`, 'info');
    },
  });
}
