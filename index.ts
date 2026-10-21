import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { clearDisplayLineCache } from './src/display-card.ts';
import { createDisplayMode } from './src/display-mode.ts';
import { registerModernTools } from './src/modern-tools.ts';
import { registerModernThinking } from './src/modern-thinking.ts';
import { registerModernPrompts } from './src/modern-prompts.ts';
import { registerModernSkillPrompts } from './src/modern-skill-prompts.ts';
import { registerModernWorkflows } from './src/modern-workflows.ts';
import { registerModernSubagentMessages } from './src/modern-subagent-messages.ts';
import { registerInspection } from './src/inspection.ts';
import { registerPermissionPresentation } from './src/permission-presentation.ts';
import { registerWorkStrip } from './src/work-strip.ts';
import { registerFoldCommand } from './src/fold-command.ts';

export default function compactRenderer(pi: ExtensionAPI): void {
  clearDisplayLineCache();
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
    clearDisplayLineCache();
    if (errors.length) throw new AggregateError(errors, 'Compact renderer cleanup failed');
  };
  try {
    // All display features share the cache; its lifetime belongs to the extension.
    for (const event of ['session_start', 'session_tree', 'session_compact', 'session_before_switch'] as const) {
      const off = pi.on(event, () => { if (!disposed) clearDisplayLineCache(); });
      if (typeof off === 'function') disposers.push(off);
    }
    disposers.push(registerModernTools(pi, mode));
    disposers.push(registerModernThinking(pi, mode));
    disposers.push(registerModernPrompts(pi, mode));
    disposers.push(registerModernSkillPrompts(pi, mode));
    disposers.push(registerModernWorkflows(pi, mode));
    disposers.push(registerPermissionPresentation(pi, mode));
    disposers.push(registerModernSubagentMessages(pi, mode));
    const work = registerWorkStrip(pi, mode);
    disposers.push(work.dispose);
    disposers.push(registerFoldCommand(pi, mode, work));
    disposers.push(registerInspection(pi, mode));
  } catch (error) {
    dispose();
    throw error;
  }
  pi.on('session_shutdown', dispose);
}
