import assert from 'node:assert/strict';
import { loadSource, loadAgent, themeModule, stripAnsi } from './test-runtime.mjs';
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const hooks = new Map(); let resolver;
const pi = { registerToolRenderer(fn) { resolver = fn; }, on(event, fn) { const set = hooks.get(event) || new Set(); set.add(fn); hooks.set(event, set); return () => set.delete(fn); }, events: { on() { return () => {}; }, emit() {} } };
const mode = createDisplayMode(), dispose = registerModernTools(pi, mode);
const ctx = { hasUI: false, sessionManager: { getBranch: () => [] } };
const event = (name, data = {}) => { for (const fn of hooks.get(name) || []) fn(data, ctx); };
const create = (name, id, args, native) => {
 const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, resolver(name, () => native), { requestRender() {} }, '/tmp'); component.setArgsComplete(); return component;
};
const result = text => ({ content: [{ type: 'text', text }] });
event('session_start');
try {
 assert.equal(resolver('codemode', () => codemodeRenderers), codemodeRenderers, 'native script/call renderer is retained exactly');
 const first = create('read', 'before-code', { path: '/fixture/before' }, readRenderers); first.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'code', name: 'codemode', arguments: { code: 'text(1);' } }] } });
 const code = create('codemode', 'code', { code: 'const value = await tools.read({path: "/fixture"});\ntext(value);' }, codemodeRenderers);
 const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval, intervals = new Set();
 globalThis.setInterval = (...args) => { const handle = originalSetInterval(...args); intervals.add(handle); return handle; };
 globalThis.clearInterval = handle => { intervals.delete(handle); return originalClearInterval(handle); };
 try {
  code.markExecutionStarted();
  code.updateResult({ ...result(''), details: { calls: [{ name: 'read', args: '/fixture', status: 'running' }] } }, true);
  assert.equal(intervals.size, 1);
  const running = stripAnsi(code.render(100).join('\n')); assert.match(running, /codemode/); assert.match(running, /const value/); assert.match(running, /… read/);
  const final = { content: [{ type: 'text', text: 'Script completed\nWall time 0.25 seconds\nOutput:\n' }, { type: 'text', text: 'Recorded script output' }], details: { calls: [{ name: 'read', args: '/fixture', status: 'ok', durationMs: 250 }, { name: 'model', args: 'fixture', status: 'error', durationMs: 500, cost: 0.02, error: 'Recorded nested failure' }] } };
  const before = JSON.stringify(final);
  code.updateResult(final);
  assert.equal(intervals.size, 0, 'native completed result stops its own timer');
  code.setExpanded(true);
  const expanded = stripAnsi(code.render(100).join('\n'));
  for (const pattern of [/✓ read/, /250ms/, /✗ model/, /500ms/, /\$0\.02/, /Recorded nested failure/, /Recorded script output/]) assert.match(expanded, pattern);
  assert.doesNotMatch(expanded, /arguments\.code|successful action/);
  assert.equal(JSON.stringify(final), before);
 } finally { for (const handle of intervals) originalClearInterval(handle); globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval; }
 event('message_end', { message: { role: 'toolResult', toolName: 'codemode', toolCallId: 'code', ...result('done') } });
 const last = create('read', 'after-code', { path: '/fixture/after' }, readRenderers); last.updateResult(result('last'));
 for (const component of [first, last]) { const text = stripAnsi(component.render(100).join('\n')); assert.match(text, /read · \/fixture\/(?:before|after) · ✓ Completed/); assert.doesNotMatch(text, /2 successful actions/); }
 console.log('codemode: native renderer identity, script, nested status/errors/time/cost, timer and group boundaries passed');
} finally { dispose(); }
