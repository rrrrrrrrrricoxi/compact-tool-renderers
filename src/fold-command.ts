import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DisplayMode } from './display-mode.ts';
import type { WorkStripControls } from './work-strip.ts';

type FoldMode = DisplayMode & { setEnabled(enabled: boolean): boolean };

/** One session-local command owns display mode, work expansion, and its shortcut. */
export function registerFoldCommand(pi: ExtensionAPI, mode: FoldMode, work: WorkStripControls): () => void {
  let disposed = false;
  pi.registerCommand('fold', {
    description: 'Choose Pi Fold display, collapse or expand work, or set its shortcut',
    async handler(args, ctx) {
      if (disposed) return;
      let choice = args.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
      if (!choice && ctx.hasUI) {
        const current = mode.isEnabled() ? 'on' : 'off';
        const choices = [
          `on${current === 'on' ? ' (current)' : ''} — fold work and recorded thinking`,
          `off${current === 'off' ? ' (current)' : ''} — native display`,
          'collapse — collapse completed work sections',
          'expand — expand all work sections',
          'shortcut — choose Ctrl+Alt+W shortcut',
        ];
        const selected = await ctx.ui.select('Pi Fold — this session', choices);
        if (disposed || selected === undefined) return;
        const index = choices.indexOf(selected);
        if (index < 0) return;
        choice = ['on', 'off', 'collapse', 'expand', 'shortcut'][index];
        if (choice === current) return;
      }
      if (['', 'status', 'on', 'off', 'toggle'].includes(choice)) {
        if (choice === 'on' || choice === 'off' || choice === 'toggle') {
          mode.setEnabled(choice === 'toggle' ? !mode.isEnabled() : choice === 'on');
        }
        ctx.ui.notify(`Pi Fold ${mode.isEnabled() ? 'on' : 'off'}`, 'info');
      } else if (choice === 'collapse' || choice === 'expand') {
        if (!mode.isEnabled()) {
          ctx.ui.notify(`Turn Pi Fold on with /fold on before you ${choice} work sections.`, 'info');
          return;
        }
        const changed = work.setExpanded(choice === 'expand');
        ctx.ui.notify(changed ? `Work sections ${choice === 'expand' ? 'expanded' : 'collapsed'}` : 'Work sections are unavailable in this session.', 'info');
      } else if (['shortcut', 'shortcut on', 'shortcut off'].includes(choice)) {
        let enabled = choice === 'shortcut' ? undefined : choice === 'shortcut on';
        if (enabled === undefined && ctx.hasUI) {
          const current = work.isShortcutEnabled() ? 'on' : 'off';
          const choices = ['on', 'off'].map(value => `${value}${value === current ? ' (current)' : ''}`);
          const selected = await ctx.ui.select('Collapse work shortcut — Ctrl+Alt+W', choices);
          if (disposed || selected === undefined || !choices.includes(selected)) return;
          enabled = selected === choices[0];
          if (enabled === work.isShortcutEnabled()) return;
        }
        if (enabled !== undefined) work.setShortcutEnabled(enabled);
        ctx.ui.notify(`Collapse work shortcut: ${work.isShortcutEnabled() ? 'on' : 'off'}`, 'info');
      } else {
        ctx.ui.notify('Use /fold [on|off|toggle|status|collapse|expand|shortcut [on|off]]', 'info');
      }
    },
  });
  return () => { disposed = true; };
}
