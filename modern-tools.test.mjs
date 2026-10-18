import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { loadSource, loadAgent, tui, themeModule, stripAnsi, core, runtime, assertCardBackground, backgroundCells } from './test-runtime.mjs';
const { cardRow } = await loadSource('./display-card.ts');
for (const width of [1, 2, 8, 30]) assertCardBackground([cardRow('a\x1b[0mb\x1b[49mc\x1b[38;2;0;49;0md', width, themeModule.theme, 'toolSuccessBg')], width, 'toolSuccessBg');
const nested = cardRow('a\x1b[48;5;0mb\x1b[49mc', 12, themeModule.theme, 'toolSuccessBg');
assert.equal(backgroundCells(nested)[2], '48;5;0', 'an explicit nested surface stays intact');
assert.equal(backgroundCells(nested)[3], backgroundCells(nested)[0], 'base surface resumes after a nested background reset');
const { registerModernTools, toolStatus, isNativeSubagent } = await loadSource('./modern-tools.ts');
const { ToolPane } = await loadSource('./modern-tool-pane.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const hooks = new Map();
const bus = new Map();
let resolver, input, enabled = true, modeChange, redraws = 0;
const pi = {
  registerToolRenderer(fn) { resolver = fn; },
  on(name, fn) { const list = hooks.get(name) || []; list.push(fn); hooks.set(name, list); return () => hooks.set(name, (hooks.get(name) || []).filter(item => item !== fn)); },
  events: { on(name, fn) { bus.set(name, fn); return () => bus.delete(name); }, emit(name, value) { bus.get(name)?.(value); } },
};
const mode = { isEnabled: () => enabled, onChange(fn) { modeChange = fn; return () => { modeChange = undefined; }; } };
const dispose = registerModernTools(pi, mode);
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput(fn) { input = fn; return () => { input = undefined; }; } } };
const event = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
const toggle = (value) => { enabled = value; modeChange(); };
event('session_start');
const native = new Map([['bash', createShellRenderers('$')], ['read', readRenderers], ['codemode', codemodeRenderers]]);
const stockCalls = [];
const make = (name, id, args) => {
  const original = native.get(name) || { renderCall: () => new tui.Text('native call', 0, 0), renderResult: () => new tui.Text('native result', 0, 0) };
  const renderer = resolver(name, () => original);
  const wrapped = { ...renderer,
    renderCall(...args) { const result = renderer.renderCall(...args); stockCalls.push(result); return result; },
    renderResult(...args) { return renderer.renderResult(...args); },
  };
  const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, wrapped, { requestRender() { redraws++; assert.ok(redraws < 1000, 'bounded native redraw'); } }, '/tmp');
  component.setArgsComplete();
  return component;
};
const paint = (component, width = 120) => stripAnsi(component.render(width).join('\n'));
const result = (text, details = {}) => ({ content: [{ type: 'text', text }], details });
const read = make('read', 'a', { path: '/tmp/first.txt' });
read.markExecutionStarted(); read.updateResult(result('first output'));
const shell = make('bash', 'b', { command: 'printf hello' }); shell.markExecutionStarted(); shell.updateResult(result('streaming'), true);
assert.match(paint(read), /1 successful action/);
assert.match(paint(shell), /running/);
for (const component of [read]) {
  const rows = component.render(100);
  assert.equal(rows.length, 4, 'collapsed card retains the native spacer plus Box(1,1) height');
  assert.equal(stripAnsi(rows[1]).trim(), '', 'native top background row');
  assert.equal(stripAnsi(rows.at(-1)).trim(), '', 'native bottom background row');
}
assertCardBackground(read.render(100).slice(1), 100, 'toolSuccessBg');
assertCardBackground(read.render(100).filter(row => stripAnsi(row).trim()), 100, 'toolSuccessBg');
assertCardBackground(shell.render(100).filter(row => stripAnsi(row).trim()), 100, 'toolPendingBg');
assert.doesNotMatch(paint(read), /Alt\+G/, 'unfocused collapsed cards omit repeated key hints');
shell.updateResult(result('hello', { exitCode: 0 }));
assert.match(paint(read), /2 successful actions/);
assert.equal(paint(shell), '');
assert.equal(input('\x1b[A'), undefined, 'editor arrows remain untouched until pane focus');
assert.equal(input('\x1bg').consume, true);
assert.match(paint(read), /first.txt/);
const focusedAction = read.render(100).find(row => stripAnsi(row).includes('1. read'));
assertCardBackground([focusedAction], 100, 'selectedBg');
assert.ok(focusedAction.includes(themeModule.theme.getFgAnsi('accent')), 'selection has a clear native foreground');
input('\r');
assert.match(paint(read), /Exact arguments/);
assert.match(paint(read), /first output/);
const detailLayout = read.render(100).map(stripAnsi);
assert.match(detailLayout[2], /^ ▾ /, 'header uses the native one-cell gutter');
assert.match(detailLayout.find(row => row.includes('1. read')), /^   › ▾ /, 'actions sit inside the group heading');
assert.equal(detailLayout.find(row => row.includes('first output')).indexOf('first output'), detailLayout.find(row => row.includes('1. read')).indexOf('read'), 'recorded output aligns with the expanded action label');
assert.match(detailLayout.at(-2), /^ 1\//, 'footer shares the header gutter');
assert.doesNotMatch(detailLayout.join('\n'), /c collapse/);
input('\x1b[C'); input('\r');
assert.match(paint(read), /printf hello/);
assert.match(paint(read), /hello/);
input('\x1b[D');
assert.match(paint(read), /first output/, 'first action remains expanded');
input('\x1b'); assert.equal(input('\x1b[B'), undefined);
assertCardBackground(read.render(100).filter(row => stripAnsi(row).trim()), 100, 'toolSuccessBg');
assert.doesNotMatch(paint(read), /Enter details/, 'unfocused open cards show only the short inspection hint');
// Mode changes synchronously rerender the actual native component and preserve slot ownership.
for (let iteration = 0; iteration < 8; iteration++) {
  toggle(false);
  assert.match(paint(shell), /\$ printf hello/);
  assert.match(paint(shell), /hello/);
  read.setExpanded(true);
  assert.match(paint(read), /first output/);
  assert.equal(read.callRendererComponent.constructor.name, 'Box');
  assert.deepEqual(read.callRendererComponent.children.map(child => child.constructor.name), ['Text', 'Text']);
  assert.deepEqual(shell.callRendererComponent.children.map(child => child.constructor.name), ['Text', 'Container']);
  assert.equal(shell.resultRendererComponent.render(120).length, 0, 'one Box owns both stock render slots');
  toggle(true);
  assert.match(paint(read), /2 successful actions/);
}
// Mode off reproduces the full default native shell, including ANSI backgrounds and padding.
toggle(false);
const actualNow = Date.now; Date.now = () => 100000;
try {
  for (const outputPad of [0, 1, 3]) for (const name of ['bash', 'read', 'native-generic']) {
    const args = name === 'bash' ? { command: 'printf safe' } : { path: '/tmp/shell-fixture' };
    const originalDefinition = native.get(name) || {};
    const wrappedDefinition = resolver(name, () => originalDefinition);
    const create = (definition, id) => new ToolExecutionComponent(name, id, args, { showImages: false, outputPad }, definition, { requestRender() {} }, '/tmp');
    const original = create(originalDefinition, `appearance-original-${name}-${outputPad}`);
    const wrapped = create(wrappedDefinition, `appearance-wrapped-${name}-${outputPad}`);
    try {
      original.markExecutionStarted(); wrapped.markExecutionStarted();
      for (const phase of ['running', 'completed', 'error']) {
        const final = { ...result(`native ${phase} output`), isError: phase === 'error', durationMs: phase === 'running' ? undefined : 500 };
        original.updateResult(final, phase === 'running'); wrapped.updateResult(final, phase === 'running');
        for (const expanded of [false, true]) {
          original.setExpanded(expanded); wrapped.setExpanded(expanded);
          for (const width of [20, 90]) assert.deepEqual(wrapped.render(width), original.render(width), `${name}/${phase}/pad=${outputPad}/expanded=${expanded}/width=${width}`);
          const background = phase === 'running' ? 'toolPendingBg' : phase === 'error' ? 'toolErrorBg' : 'toolSuccessBg';
          assert.ok(wrapped.render(90).some(line => line.includes(themeModule.theme.getBgAnsi(background))), 'effective native background ANSI is retained');
        }
      }
    } finally { original.updateResult(result('final cleanup')); wrapped.updateResult(result('final cleanup')); }
  }
  // Tools that frame themselves keep their existing renderShell semantics.
  const selfStock = { renderShell: 'self', renderCall: () => new tui.Text('own call', 0, 0), renderResult: () => new tui.Text('own result', 0, 0) };
  const selfOriginal = new ToolExecutionComponent('self-tool', 'self-original', {}, { outputPad: 3, showImages: false }, selfStock, { requestRender() {} }, '/tmp');
  const selfWrapped = new ToolExecutionComponent('self-tool', 'self-wrapped', {}, { outputPad: 3, showImages: false }, resolver('self-tool', () => selfStock), { requestRender() {} }, '/tmp');
  selfOriginal.updateResult(result('own')); selfWrapped.updateResult(result('own'));
  assert.deepEqual(selfWrapped.render(80), selfOriginal.render(80));
} finally { Date.now = actualNow; toggle(true); }
// A failed row remains conspicuous and breaks adjacent success groups.
const fail = make('bash', 'c', { command: 'false' });
fail.updateResult({ ...result('failure', { exitCode: 1 }), isError: true });
const after = make('read', 'd', { path: '/tmp/after.txt' }); after.updateResult(result('after'));
assert.match(paint(fail), /failed/); assert.match(paint(after), /1 successful action/);
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1, 'failure uses one exceptional header');
assert.match(paint(fail), /failed · failure/, 'header includes a bounded recorded failure excerpt');
const failedHeader = fail.render(120).find(line => stripAnsi(line).includes('failed'));
assert.ok(failedHeader.includes(themeModule.theme.getFgAnsi('error')), 'failed header uses native error color');
assertCardBackground([failedHeader], 120, 'toolErrorBg');
const partialFailureOutput = 'partial failure output\nexact second failure line';
fail.updateResult({ ...result(partialFailureOutput, { error: 'Recorded denial: ' + 'x'.repeat(5000) }), isError: true }, true);
assert.match(paint(fail), /failed · Recorded denial:/, 'partial errors remain visible as exceptional cards');
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1);
assert.ok(paint(fail, 500).split('\n').map(row => row.trim()).join('').length < 400, 'collapsed failure reason has a bounded length before the full-width card gutter');
const failureMouse = (y) => fail.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: fail.render(120).length, shift: false, alt: false, ctrl: false });
failureMouse(2); failureMouse(3);
assert.match(paint(fail), /partial failure output/);
assert.match(paint(fail), /exact second failure line/, 'full recorded failure output remains inline');
input('\x1b');
assert.equal(toolStatus('read', result('Error is a word in successful recorded output')).status, 'success', 'prose never determines failure status');
// Visible transcript boundaries, question contracts and native subagent exemption.
event('message_end', { message: { role: 'user', content: 'next task' } });
const next = make('read', 'e', { path: '/tmp/next.txt' }); next.updateResult(result('next'));
assert.match(paint(next), /1 successful action/);
for (const name of ['subagent', 'subagent_message', 'subagents', 'fleet_status', 'mcp__fleet_status']) {
  assert.equal(isNativeSubagent(name), true);
  const stock = {}; assert.equal(resolver(name, () => stock), stock);
}
assert.equal(toolStatus('bash', result('error'), true, true).status, 'failed', 'partial errors remain failed');
for (const status of ['started', 'running', 'unavailable', 'cancelled']) assert.notEqual(toolStatus('custom', result('notice', { status })).status, 'success');
for (const status of ['cancelled', 'unavailable']) assert.equal(toolStatus('ask_user_question', result('', { status })).status, status);
assert.equal(toolStatus('ask_user_question', result('', { status: 'answered', answers: [] })).status, 'unanswered');
const ask = make('ask_user_question', 'q', { question: 'Which host?' });
assert.match(paint(ask), /Question · Pending · Which host/);
assertCardBackground(ask.render(100).filter(row => stripAnsi(row).trim()), 100, 'userMessageBg');
ask.updateResult(result('User answered: MacBook', { question: 'Which host?', status: 'answered', answers: [{ label: 'MacBook', value: 'mac' }] }));
assert.match(paint(ask), /Question · Answered · Which host\? · MacBook/);
assertCardBackground(ask.render(100).filter(row => stripAnsi(row).trim()), 100, 'userMessageBg');
assert.equal((paint(ask).match(/Question ·/g) || []).length, 1);
for (const [status, expected, isError] of [['unavailable', 'Unavailable', false], ['cancelled', 'Cancelled', false], ['answered', 'Unanswered', false], ['failed', 'Failed', true]]) {
  ask.updateResult({ ...result('No recorded answer', { question: 'Which host?', status, answers: [] }), isError });
  assert.match(paint(ask), new RegExp(`Question · ${expected}`));
  assert.doesNotMatch(paint(ask), /MacBook/, 'prior answers cannot leak into a later unresolved interaction');
}
const recorded = { role: 'user', content: [{ type: 'text', text: 'unchanged source' }] };
const sourceBefore = JSON.stringify(recorded); event('message_end', { message: recorded });
assert.equal(JSON.stringify(recorded), sourceBefore, 'event observation does not mutate model/history messages');
// Prompt focus and mutual focus return arrows to the editor.
input('\x1bg'); event('ui_prompt_start'); assert.equal(input('\x1b[A'), undefined);
input('\x1bg'); pi.events.emit('compact-renderer:focus:v1', { owner: 'thinking' }); assert.equal(input('\x1b[A'), undefined);
// Mouse coordinates pass through real native self-render shells and MouseRegion routing.
event('message_end', { message: { role: 'user', content: 'mouse fixture' } });
const mouseFirst = make('read', 'mouse-first', { path: '/tmp/mouse-first' }); mouseFirst.updateResult(result('mouse first output'));
const mouseSecond = make('read', 'mouse-second', { path: '/tmp/mouse-second' }); mouseSecond.updateResult(result('mouse second output'));
const mouseAt = (component, type, y, extra = {}) => {
  const lines = component.render(120);
  return component.handleMouse({ type, button: type === 'wheel' ? 'none' : 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: lines.length, shift: false, alt: false, ctrl: false, ...extra });
};
const rowAt = (component, fragment) => component.render(120).findIndex(line => stripAnsi(line).includes(fragment));
assert.equal(mouseAt(mouseFirst, 'click', 0), undefined, 'native spacer cannot focus a pane');
assert.equal(input('\x1b[A'), undefined);
assert.equal(mouseAt(mouseFirst, 'wheel', 2, { wheelDelta: 3 }), undefined, 'closed pane preserves transcript wheel scrolling');
assert.equal(mouseAt(mouseFirst, 'click', 2, { x: -1 }).handled, true);
assert.equal(input('\x1b[A'), undefined, 'outside x suppresses native toggle without focus');
assert.equal(mouseAt(mouseFirst, 'click', 1).handled, true, 'top padding contains clicks without toggling');
assert.doesNotMatch(paint(mouseFirst), /1\. read/);
assert.equal(mouseAt(mouseFirst, 'click', 2).handled, true);
assert.doesNotMatch(paint(mouseFirst), /focused/);
assert.equal(input('\r'), undefined, 'mouse expansion leaves Enter with the editor');
assert.match(paint(mouseFirst), /1\. read/);
mouseAt(mouseFirst, 'click', rowAt(mouseFirst, '1. read'));
assert.match(paint(mouseFirst), /mouse first output/);
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: 2 });
const secondActionRow = rowAt(mouseFirst, '2. read'); assert.ok(secondActionRow > 0);
mouseAt(mouseFirst, 'click', secondActionRow);
assert.match(paint(mouseFirst), /mouse first output/, 'clicking second action preserves the earlier inline output');
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: 9 });
assert.match(paint(mouseFirst), /▾ 2\. read/, 'second action expands independently');
assert.match(paint(mouseFirst), /mouse second output/);
input('\x1b');
const outputRow = rowAt(mouseFirst, 'mouse second output');
mouseAt(mouseFirst, 'click', outputRow);
assert.equal(input('\x1b[A'), undefined, 'output text click does not take keyboard focus');
assert.match(paint(mouseFirst), /mouse second output/, 'output click cannot trigger native whole-row collapse');
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: -20 });
assert.match(paint(mouseFirst), /mouse first output/);
mouseAt(mouseFirst, 'click', 2);
assert.doesNotMatch(paint(mouseFirst), /1\. read/, 'group header closes the inline pane');
input('\x1b');
assert.equal(input('\x1b[A'), undefined);
assert.equal(mouseAt(mouseFirst, 'click', 10000), undefined);
// Track actual native shell intervals, without leaking a real clock if an assertion fails.
const actualSetInterval = globalThis.setInterval, actualClearInterval = globalThis.clearInterval;
const intervals = new Set();
globalThis.setInterval = (...args) => { const handle = actualSetInterval(...args); intervals.add(handle); return handle; };
globalThis.clearInterval = (handle) => { intervals.delete(handle); return actualClearInterval(handle); };
try {
  for (const finish of ['success', 'error', 'cancel']) {
    toggle(false);
    const running = make('bash', `clock-${finish}`, { command: 'printf safe' });
    running.markExecutionStarted(); running.updateResult(result('partial'), true);
    assert.equal(intervals.size, 1);
    toggle(true); assert.equal(intervals.size, 0, 'collapse releases native timer');
    running.updateResult({ ...result('done', finish === 'cancel' ? { status: 'cancelled' } : {}), isError: finish === 'error' });
    assert.equal(intervals.size, 0);
  }
  toggle(false);
  const running = make('bash', 'clock-switch', { command: 'printf safe' });
  running.markExecutionStarted(); running.updateResult(result('partial'), true);
  assert.equal(intervals.size, 1);
  event('session_before_switch'); assert.equal(intervals.size, 0); assert.equal(input, undefined);
  event('session_start', { reason: 'resume' }); assert.equal(typeof input, 'function');
  running.invalidate(); assert.equal(intervals.size, 0, 'late old-session invalidation does not restart a timer');
  const resumed = make('read', 'resumed', { path: '/tmp/resumed' }); resumed.updateResult(result('resumed output'));
  toggle(true); assert.match(paint(resumed), /1 successful action/);
  event('session_compact'); event('session_tree');
  toggle(false);
  const shutdownRunning = make('codemode', 'clock-shutdown', { code: 'text(1)' });
  shutdownRunning.markExecutionStarted(); shutdownRunning.updateResult(result('partial', { calls: [] }), true);
  assert.equal(intervals.size, 1, 'codemode uses the same native timer contract');
  dispose(); dispose(); assert.equal(intervals.size, 0); assert.equal(input, undefined); assert.equal(modeChange, undefined);
} finally { for (const handle of intervals) actualClearInterval(handle); globalThis.setInterval = actualSetInterval; globalThis.clearInterval = actualClearInterval; }
// A 10 MB output is not eagerly split or painted. Stored source remains unchanged.
const huge = '漢字🙂 exact\x1b[31m\n'.repeat(400000);
// Pi's real Box establishes the reference for default card spacing.
const nativeBox = new tui.Box(1, 1, text => themeModule.theme.bg('toolSuccessBg', text));
nativeBox.addChild(new tui.Text('▸ Ref', 0, 0));
const referencePane = new ToolPane([], 'Ref');
referencePane.theme = themeModule.theme;
for (const width of [8, 30, 80]) {
  assert.deepEqual(referencePane.render(width).map(stripAnsi), nativeBox.render(width).map(stripAnsi));
  assertCardBackground(referencePane.render(width), width, 'toolSuccessBg');
}
const multiDigit = new ToolPane(Array.from({ length: 10 }, (_, index) => ({ id: String(index), label: 'read', sections: function* () { yield 'tenth output'; } })), 'Ten actions');
multiDigit.open = true;
for (let index = 0; index < 9; index++) multiDigit.handle('\x1b[C');
multiDigit.expanded.add('9');
const tenthRows = multiDigit.render(80).map(stripAnsi);
assert.equal(tenthRows.find(row => row.includes('tenth output')).indexOf('tenth output'), tenthRows.find(row => row.includes('10. read')).indexOf('read'), 'detail alignment includes the full multi-digit action prefix');
const pane = new ToolPane([{ id: 'large', label: 'large', sections: function* () { yield huge; } }], 'Large', () => 10);
pane.open = true; pane.expanded.add('large');
for (const width of [1, 8, 20, 80]) {
  const rows = pane.render(width); assert.ok(rows.length <= 10);
  for (const row of rows) assert.ok(tui.visibleWidth(row) <= width);
}
assert.ok(pane.paintedRows < 100, 'painting cost follows viewports rather than output size');
pane.handle('\x1b[6~'); pane.render(80); assert.ok(pane.paintedRows < 120);
assert.ok(huge.includes('\x1b[31m'), 'source escapes remain untouched');
const longLinePane = new ToolPane([{ id: 'line', label: 'long line', sections: function* () { yield 'x'.repeat(10000000); } }], 'Long line', () => 8);
longLinePane.open = true; longLinePane.expanded.add('line'); longLinePane.render(20);
assert.ok(longLinePane.paintedRows <= 8, 'one long line paints a bounded prefix');
// History reconstruction groups once, and repeated ordinary paints do not rescan old records.
let historyReads = 0;
const history = [];
for (let index = 0; index < 1500; index++) {
  const args = { path: `/tmp/history-${index}` };
  history.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: `history-${index}`, name: 'read', arguments: args }] } });
  const entry = { role: 'toolResult', toolCallId: `history-${index}`, toolName: 'read', content: [{ type: 'text', text: 'recorded' }] };
  Object.defineProperty(entry, 'details', { get() { historyReads++; return undefined; } });
  history.push({ type: 'message', message: entry });
}
ctx.sessionManager.getBranch = () => history;
enabled = true;
const disposeHistory = registerModernTools(pi, mode);
event('session_start', { reason: 'reload' });
assert.ok(historyReads < 1500 * 12, `history rebuild reads grow linearly: ${historyReads}`);
const historyRow = make('read', 'history-0', history[0].message.content[0].arguments);
historyRow.updateResult({ content: history[1].message.content, details: undefined });
const readsAfterAttach = historyReads;
for (let iteration = 0; iteration < 20; iteration++) { historyRow.invalidate(); paint(historyRow); }
assert.equal(historyReads, readsAfterAttach, 'unchanged paints never walk history');
const noResultRenderer = resolver('no-result-renderer', () => ({ renderCall: () => new tui.Text('native call', 0, 0) }));
const noResultContext = { toolCallId: 'no-result-context', args: {}, state: {}, cwd: '/tmp', expanded: true, executionStarted: false, isPartial: false, isError: false, outputPad: 1, invalidate() {} };
noResultRenderer.renderCall({}, themeModule.theme, noResultContext);
event('session_start', { reason: 'reload' });
assert.match(stripAnsi(noResultRenderer.renderResult(result('stale recorded output'), { expanded: true, isPartial: false }, themeModule.theme, noResultContext).render(80).join('\n')), /stale recorded output/);
const unsupportedContext = { ...noResultContext, state: undefined };
assert.match(stripAnsi(noResultRenderer.renderResult(result('unsupported recorded output'), { expanded: false, isPartial: false }, themeModule.theme, unsupportedContext).render(80).join('\n')), /unsupported recorded output/);
disposeHistory();
// Use Pi's actual compaction-aware initial display projection. Hidden earlier tools cannot own a visible group.
const recordedSession = core.SessionManager.inMemory('/synthetic-tools');
const recordedArgs = [];
for (let index = 0; index < 3; index++) {
  const args = { path: `/tmp/retained-${index}` }; recordedArgs.push(args);
  recordedSession.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: `retained-${index}`, name: 'read', arguments: args }] });
  recordedSession.appendMessage({ role: 'toolResult', toolCallId: `retained-${index}`, toolName: 'read', ...result(`retained output ${index}`) });
}
const retainedEntry = recordedSession.getBranch().find(entry => entry.type === 'message' && entry.message.content?.[0]?.id === 'retained-1');
recordedSession.appendCompaction('Fixture summary before retained tools', retainedEntry.id, 100);
ctx.sessionManager = recordedSession;
const disposeProjection = registerModernTools(pi, mode);
event('session_start', { reason: 'resume' });
let nativeMessages;
core.InteractiveMode.prototype.renderSessionEntries.call({ renderer: undefined, renderSessionItems(items) { nativeMessages = items; } }, recordedSession.buildContextEntries());
const retainedRows = [];
for (const message of nativeMessages) {
  if (message.role === 'assistant') for (const call of message.content ?? []) if (call.type === 'toolCall') retainedRows.push(make(call.name, call.id, call.arguments));
  if (message.role === 'toolResult') retainedRows.at(-1).updateResult(message);
}
assert.equal(retainedRows.length, 2);
assert.match(paint(retainedRows[0]), /2 successful actions/);
assert.equal(paint(retainedRows[1]), '');
event('session_compact'); assert.match(paint(retainedRows[0]), /2 successful actions/);
// Old native rows are stale after rebuild; newly replayed rows use the retained projection again.
const replayed = make('read', 'retained-1', recordedArgs[1]); replayed.updateResult(result('retained output 1'));
assert.match(paint(replayed), /2 successful actions/);
// Import only installed presentation functions; never initialize extension execution/watchers or launch an agent.
const subagentRenderFile = path.join(runtime, 'node_modules/pi-subagents/src/tui/render.js');
if (existsSync(subagentRenderFile)) {
  const { renderSubagentResult, renderSubagentSummary } = await import(pathToFileURL(subagentRenderFile));
  const fixture = result('stock subagent fixture output', { mode: 'single', results: [] });
  for (const renderResult of [renderSubagentResult, renderSubagentSummary]) {
    const installedRenderer = { renderResult };
    assert.equal(resolver('subagent', () => installedRenderer), installedRenderer, 'installed native renderer is returned by identity');
    const original = new ToolExecutionComponent('subagent', 'native-original', { agent: 'fixture' }, { showImages: false }, installedRenderer, { requestRender() {} }, '/synthetic-tools');
    const exempted = new ToolExecutionComponent('subagent', 'native-exempted', { agent: 'fixture' }, { showImages: false }, resolver('subagent', () => installedRenderer), { requestRender() {} }, '/synthetic-tools');
    for (const expanded of [false, true]) {
      original.updateResult(fixture); original.setExpanded(expanded);
      exempted.updateResult(fixture); exempted.setExpanded(expanded);
      assert.deepEqual(exempted.render(120), original.render(120));
      assert.doesNotMatch(paint(exempted), /successful action/);
    }
  }
} else console.log('installed pi-subagents presentation check skipped: package unavailable');
disposeProjection();
console.log('modern tools: native lifecycle, grouping, questions, focus and bounded output passed');
