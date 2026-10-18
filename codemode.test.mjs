import assert from 'node:assert/strict';
import { loadSource, loadAgent, themeModule, stripAnsi, tui, backgroundCells } from './test-runtime.mjs';
const { registerModernTools, toolStatus } = await loadSource('./modern-tools.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const hooks = new Map(), bus = new Map(); let resolver, input;
const pi = {
 registerToolRenderer(fn) { resolver = fn; },
 on(event, fn) { const set = hooks.get(event) || new Set(); set.add(fn); hooks.set(event, set); return () => set.delete(fn); },
 events: { on(name, fn) { bus.set(name, fn); return () => bus.delete(name); }, emit(name, data) { bus.get(name)?.(data); } },
};
const mode = createDisplayMode(), dispose = registerModernTools(pi, mode);
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput(fn) { input = fn; return () => { input = undefined; }; } } };
const event = (name, data = {}) => { for (const fn of hooks.get(name) || []) fn(data, ctx); };
const create = (name, id, args, native) => {
 const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, resolver(name, () => native), { requestRender() {} }, '/tmp'); component.setArgsComplete(); return component;
};
const result = text => ({ content: [{ type: 'text', text }] });
const paint = component => stripAnsi(component.render(140).join('\n'));
const mouse = (component, type, y, wheelDelta) => component.handleMouse({ type, button: type === 'wheel' ? 'none' : 'left', x: 2, y, screenX: 2, screenY: y, width: 140, height: component.render(140).length, shift: false, alt: false, ctrl: false, wheelDelta });
event('session_start');
try {
 assert.notEqual(resolver('codemode', () => codemodeRenderers), codemodeRenderers, 'code gets its own compact wrapper');
 const first = create('read', 'before-code', { path: '/fixture/before' }, readRenderers); first.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'code', name: 'codemode', arguments: { code: 'text(1);' } }] } });
 const code = create('codemode', 'code', { code: 'const value = await tools.read({path: "/fixture"});\ntext(value);' }, codemodeRenderers);
 const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval, intervals = new Set();
 globalThis.setInterval = (...args) => { const handle = originalSetInterval(...args); intervals.add(handle); return handle; };
 globalThis.clearInterval = handle => { intervals.delete(handle); return originalClearInterval(handle); };
 try {
  code.markExecutionStarted();
  code.updateResult({ ...result(''), details: { calls: [{ name: 'read', args: '/fixture', status: 'running' }] } }, true);
  assert.equal(intervals.size, 1, 'collapsed execution retains one native timer');
  assert.match(paint(code), /▸ codemode · … Running · 1 nested call/);
  assert.equal(code.render(100).length, 2, 'native spacer plus one compact summary');
  assert.doesNotMatch(paint(code), /const value|… read/);
  mouse(code, 'click', 1);
  assert.match(paint(code), /const value/); assert.match(paint(code), /… read/);
  assert.equal(input('\r'), undefined, 'mouse does not take editor focus');
  mouse(code, 'click', 1);
  const final = { durationMs: 750, content: [{ type: 'text', text: 'Script completed\nWall time 0.75 seconds\nOutput:\n' }, { type: 'text', text: 'Recorded script output' }], details: { calls: [{ name: 'read', args: '/fixture', status: 'ok', durationMs: 250 }, { name: 'model', args: 'fixture', status: 'error', durationMs: 500, cost: 0.02, error: 'Recorded nested failure' }] } };
  const before = JSON.stringify(final);
  code.updateResult(final);
  assert.equal(intervals.size, 0, 'native completion stops its timer');
  assert.match(paint(code), /✓ Completed · 2 nested calls · 1 nested error · 0.75s/);
  assert.doesNotMatch(paint(code), /✗ Failed|Recorded script output|Recorded nested failure/);
  assert.equal(toolStatus('codemode', final).status, 'success', 'handled nested errors do not fail the script');
  const header = code.render(140).find(row => stripAnsi(row).includes('nested error'));
  assert.ok(header.includes(themeModule.theme.getFgAnsi('warning')), 'nested failure warns on a completed script');
  assert.ok(backgroundCells(header).every(value => value === ''), 'collapsed summary uses neutral terminal surface');
  code.setExpanded(true);
  const pane = code.callRendererComponent.owner.code;
  const nativeExpanded = stripAnsi([...pane.nativeCall.render(136), ...pane.nativeResult.render(136)].join('\n'));
  for (const pattern of [/const value/, /✓ read/, /250ms/, /✗ model/, /500ms/, /\$0\.02/, /Recorded nested failure/, /Recorded script output/, /Took 0\.8s/]) assert.match(nativeExpanded, pattern);
  assert.ok(pane.nativeCall.render(136).some(row => row.includes('\x1b[')), 'native syntax highlighting remains');
  let visible = paint(code);
  for (let index = 0; index < 12; index++) { mouse(code, 'wheel', 2, 2); visible += '\n' + paint(code); }
  for (const pattern of [/const value/, /✓ read/, /250ms/, /✗ model/, /500ms/, /\$0\.02/, /Recorded nested failure/, /Recorded script output/, /Took 0\.8s/]) assert.match(visible, pattern);
  assert.doesNotMatch(visible, /arguments\.code|successful action/);
  assert.equal(JSON.stringify(final), before, 'rendering leaves stored transcript exact');
  const choices = []; pi.events.emit('compact-renderer:inspect:v1', { add: entry => choices.push(entry) });
  const choice = choices.find(entry => entry.label.startsWith('codemode')); assert.ok(choice); choice.focus();
  assert.match(paint(code), /focused/);
  const focused = code.render(100).find(row => stripAnsi(row).includes('codemode'));
  assert.ok(focused.includes(themeModule.theme.getBgAnsi('selectedBg')), 'inspection visibly selects header');
  assert.equal(input('\x1b[A').consume, true); assert.equal(pane.offset >= 0, true);
  assert.equal(input('\x1b').consume, true); assert.doesNotMatch(paint(code), /focused/);
  choice.focus(); assert.equal(input('x'), undefined); assert.doesNotMatch(paint(code), /focused/); assert.equal(input('\r'), undefined, 'typing releases inspection before next Enter');
  code.setExpanded(false); assert.doesNotMatch(paint(code), /Recorded script output/);
  code.setExpanded(true); assert.match(paint(code), /const value/, 'native Ctrl+O expansion sync opens native details');
  mode.setEnabled(false);
  assert.match(paint(code), /Recorded script output/); assert.equal(code.callRendererComponent.constructor.name, 'Box');
  mode.setEnabled(true); code.setExpanded(false); assert.equal(code.render(100).length, 2);
  const failed = { ...final, isError: true }; code.updateResult(failed); assert.match(paint(code), /✗ Failed · 2 nested calls · 1 nested error/);
  code.updateResult(final);
  code.updateArgs({ code: Array.from({ length: 100 }, (_, index) => `text(${index});`).join('\n') });
  code.setExpanded(true);
  for (const width of [1, 8, 40, 100]) {
   const rows = code.render(width); assert.ok(rows.length <= 21, 'expanded native content has bounded viewport');
   for (const row of rows) assert.ok(tui.visibleWidth(row) <= width);
  }
  assert.match(paint(code), /text\(0\)/);
  for (let index = 0; index < 120; index++) { mouse(code, 'wheel', 2, 20); code.render(140); }
  assert.match(paint(code), /Recorded script output/, 'bounded viewport can reach full native output');
  assert.equal(JSON.stringify(final), before);
  const running = create('codemode', 'code-clear', { code: 'text(1);' }, codemodeRenderers); running.markExecutionStarted(); running.updateResult({ ...result(''), details: { calls: [] } }, true);
  assert.equal(intervals.size, 1); event('session_before_switch'); assert.equal(intervals.size, 0, 'session switch clears native owned timer');
  running.invalidate(); assert.equal(intervals.size, 0, 'stale renderer cannot restart owned timer'); event('session_start');
 } finally { for (const handle of intervals) originalClearInterval(handle); globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval; }
 // Replay preserves script boundaries between adjacent successes.
 const replayFirst = create('read', 'replay-before', { path: '/fixture/replay-before' }, readRenderers); replayFirst.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'replay-code', name: 'codemode', arguments: { code: 'text(1)' } }] } });
 const replayCode = create('codemode', 'replay-code', { code: 'text(1)' }, codemodeRenderers); replayCode.updateResult(result('done'));
 const last = create('read', 'after-code', { path: '/fixture/after' }, readRenderers); last.updateResult(result('last'));
 assert.match(paint(last), /read · \/fixture\/after · ✓ Completed/); assert.doesNotMatch(paint(last), /2 successful actions/);
 assert.doesNotMatch(paint(replayCode), /successful action/);
 assert.match(paint(replayFirst), /read · \/fixture\/replay-before · ✓ Completed/); assert.doesNotMatch(paint(replayFirst), /2 successful actions/);
 console.log('codemode: collapsed summary, native detail components, nested outcome, timer, mouse/inspection/editor/Ctrl+O, viewport and transcript checks passed');
} finally { dispose(); }
