// Harmless controls for the isolated native preview. Never loaded by the package entry point.
export default function preview(pi: any) {
  pi.on('input', () => ({ action: 'handled' }));
  pi.on('tool_call', () => ({ block: true, reason: 'This preview never executes tools.' }));
  pi.on('user_bash', () => ({ result: { output: 'Shell execution is disabled in this preview.', exitCode: 1, cancelled: false, truncated: false } }));
  pi.on('session_start', (_event: any, ctx: any) => ctx.ui.setStatus('preview', 'FIXTURE · no model, shell, or database calls'));
  pi.registerCommand('fixture-permission', {
    description: 'Preview approval controls; no operation runs',
    async handler(_args: string, ctx: any) {
      let present: undefined | (() => Promise<boolean>), accepting = true;
      pi.events.emit('pi:permission-presentation:v1', {
        version: 1, mode: ctx.mode, ui: ctx.ui,
        action: 'Write a sample report', target: '/fixture/report.txt',
        reason: 'Preview only. Allow once and Deny both perform no operation.',
        details: JSON.stringify({ path: '/fixture/report.txt', content: Array.from({ length: 100 }, (_, i) => `Recorded example line ${i + 1} — 中文 and kg/L`).join('\n') }, null, 2),
        offer(callback: () => Promise<boolean>) { if (!accepting || present) return false; present = callback; return true; },
      });
      accepting = false;
      if (!present) { ctx.ui.notify('No compact permission presenter available.', 'warning'); return; }
      ctx.ui.notify(`Fixture decision: ${await present() ? 'Allow once' : 'Deny'}. Nothing was executed.`, 'info');
    },
  });
}
