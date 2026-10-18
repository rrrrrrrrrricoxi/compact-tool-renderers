import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { loadSource, loadAgent, tui, themeModule, stripAnsi, core, runtime, assertCardBackground, backgroundCells } from './test-runtime.mjs';
const { cardRow } = await loadSource('./display-card.ts');
for (const width of [1, 2, 8, 30]) assertCardBackground([cardRow('a\x1b[0mb\x1b[49mc\x1b[38;2;0;49;0md', width, themeModule.theme, 'toolSuccessBg')], width, 'toolSuccessBg');
const nested = cardRow('a\x1b[48;5;0mb\x1b[49mc', 12, themeModule.theme, 'toolSuccessBg');
assert.equal(backgroundCells(nested)[2], '48;5;0', 'an explicit nested surface stays intact');
assert.equal(backgroundCells(nested)[3], backgroundCells(nested)[0], 'base surface resumes after a nested background reset');
const { registerModernTools, toolStatus, toolLabel, isNativeSubagent } = await loadSource('./modern-tools.ts');
const { ToolPane, textRows } = await loadSource('./modern-tool-pane.ts');
const { recordedValues } = await loadSource('./modern-tool-content.ts');
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
const evidence = [];
const capture = (label, component) => { const lines = component.render(120); evidence.push({ label, width: 120, lines, plain: lines.map(stripAnsi) }); };
const read = make('read', 'a', { path: '/tmp/first.txt' });
read.markExecutionStarted(); read.updateResult(result('first output'));
capture('Single successful action collapsed', read);
assert.match(read.render(120).map(stripAnsi)[1], /^ ▸ read · /, 'tool name starts after the common disclosure column');
const clickSingle = (component, y) => {
  const lines = component.render(120);
  return component.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: lines.length, shift: false, alt: false, ctrl: false });
};
clickSingle(read, 1);
assert.match(paint(read), /first output/, 'one header click reveals singleton details');
assert.doesNotMatch(paint(read), /1\. read|Details|\{\}/, 'singleton has no duplicate action row or empty Details section');
assert.match(paint(read), /Arguments/);
capture('Single successful action opened by header click', read);
clickSingle(read, 1);
assert.doesNotMatch(paint(read), /first output/);
read.setExpanded(true);
assert.match(paint(read), /first output/, 'native expansion opens singleton details directly');
read.setExpanded(false);
const inspectRead = [];
pi.events.emit('compact-renderer:inspect:v1', { add: entry => inspectRead.push(entry) });
inspectRead[0].focus();
assert.match(paint(read), /first output/, 'inspection focus opens singleton details directly');
assertCardBackground([read.render(100)[1]], 100, 'selectedBg');
assert.match(paint(read), /Enter collapse/);
capture('Single successful action focused through inspection', read);
input('\r'); assert.doesNotMatch(paint(read), /first output/, 'Enter collapses a focused singleton');
input('\r'); assert.match(paint(read), /first output/, 'Enter opens a focused singleton in one step');
input('\x1b'); clickSingle(read, 1);
const shell = make('bash', 'b', { command: 'printf hello' }); shell.markExecutionStarted(); shell.updateResult(result('streaming'), true);
assert.match(paint(read), /read · \/tmp\/first\.txt/);
assert.match(paint(shell), /Running/);
assert.equal(read.render(100).length, 2, 'collapsed activity uses one summary plus native spacer');
const assertNeutral = rows => { for (const row of rows) assert.ok(backgroundCells(row).every(value => value === ''), 'compact activity keeps terminal surface'); };
assertNeutral(read.render(100));
assertNeutral(shell.render(100));
assert.doesNotMatch(paint(read), /Alt\+G/, 'unfocused collapsed cards omit repeated key hints');
shell.updateResult(result('hello', { exitCode: 0 }));
assert.match(paint(read), /2 actions/);
assert.equal(paint(shell), '');
assert.equal(input('\x1b[A'), undefined, 'editor arrows remain untouched until pane focus');
assert.equal(input('\x1bg').consume, true);
assert.match(paint(read), /first.txt/);
const focusedAction = read.render(100).find(row => stripAnsi(row).includes('1. read'));
assertCardBackground([focusedAction], 100, 'selectedBg');
assert.ok(focusedAction.includes(themeModule.theme.getFgAnsi('accent')), 'selection has a clear native foreground');
input('\r');
assert.match(paint(read), /Arguments/);
assert.match(paint(read), /first output/);
assert.doesNotMatch(paint(read), /arguments \(object\)|arguments\.path|\(string\)/, 'recorded values use local field labels');
const detailLayout = read.render(100).map(stripAnsi);
assert.match(detailLayout[1], /^ ▾ /, 'header uses the native one-cell gutter');
assert.match(detailLayout.find(row => row.includes('1. read')), /^   › ▾ /, 'actions sit inside the group heading');
assert.equal(detailLayout.find(row => row.includes('first output')).indexOf('first output'), detailLayout.find(row => row.includes('1. read')).indexOf('read'), 'recorded output aligns with the expanded action label');
assert.match(detailLayout.at(-1), /^ ←\/→ action/, 'focused hint shares the header gutter');
assertCardBackground([read.render(100)[1]], 100, 'selectedBg');
assert.ok(detailLayout.findIndex(row => row.trim() === 'Output') < detailLayout.findIndex(row => row.trim() === 'Arguments'), 'output appears before arguments');
assert.doesNotMatch(detailLayout.join('\n'), /c collapse/);
input('\x1b[C'); input('\r');
assert.match(paint(read), /printf hello/);
assert.match(paint(read), /hello/);
input('\x1b[D');
assert.match(paint(read), /first output/, 'first action remains expanded');
input('\x1b'); assert.equal(input('\x1b[B'), undefined);
assertNeutral(read.render(100));
assert.doesNotMatch(paint(read), /Enter details|Alt\+G|to inspect/, 'unfocused open cards omit keyboard hints');
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
  assert.match(paint(read), /2 actions/);
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
assert.match(paint(fail), /bash · false · ✗ Failed/); assert.match(paint(after), /read · \/tmp\/after\.txt/);
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1, 'failure uses one exceptional header');
assert.match(paint(fail), /Failed · Command failed \(exit 1\)/, 'header includes a bounded recorded failure excerpt');
assert.match(fail.render(120).map(stripAnsi)[1], /^ ▸ bash · /, 'failure status does not shift the tool name');
capture('Single failed action collapsed with status after command', fail);
const failedHeader = fail.render(120).find(line => stripAnsi(line).includes('Failed'));
assert.ok(failedHeader.includes(themeModule.theme.getFgAnsi('error')), 'failed header uses native error color');
assertNeutral([failedHeader]);
const partialFailureOutput = 'partial failure output\nexact second failure line';
fail.updateResult({ ...result(partialFailureOutput, { error: 'Recorded denial: ' + 'x'.repeat(5000) }), isError: true }, true);
assert.match(paint(fail), /Failed · Command failed/, 'partial errors remain visible as exceptional cards');
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1);
assert.ok(paint(fail, 500).split('\n').map(row => row.trim()).join('').length < 400, 'collapsed failure reason has a bounded length before the full-width card gutter');
const failureMouse = (y) => fail.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: fail.render(120).length, shift: false, alt: false, ctrl: false });
failureMouse(1); failureMouse(2);
assert.match(paint(fail), /partial failure output/);
assert.match(paint(fail), /exact second failure line/, 'full recorded failure output remains inline');
assert.doesNotMatch(paint(fail), /1\. bash/, 'failed action opens without a numbered duplicate');
capture('Single failed action opened directly', fail);
input('\x1b');
assert.equal(toolStatus('read', result('Error is a word in successful recorded output')).status, 'success', 'prose never determines failure status');
// Visible transcript boundaries, question contracts and native subagent exemption.
event('message_end', { message: { role: 'user', content: 'next task' } });
const next = make('read', 'e', { path: '/tmp/next.txt' }); next.updateResult(result('next'));
assert.match(paint(next), /read · \/tmp\/next\.txt/);
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
assert.match(ask.render(120).map(stripAnsi)[1], /^ ▸ Question · /, 'question title shares the tool disclosure column');
assertNeutral(ask.render(100));
assert.ok(ask.render(100).find(row => stripAnsi(row).includes('Question ·')).includes(themeModule.theme.getFgAnsi('toolTitle')), 'question heading uses neutral title color');
capture('Question pending with neutral native surface', ask);
ask.updateResult(result('User answered: MacBook', { question: 'Which host?', status: 'answered', answers: [{ label: 'MacBook', value: 'mac' }] }));
assert.match(paint(ask), /Question · Answered · Which host\? · MacBook/);
assertNeutral(ask.render(100));
assert.equal((paint(ask).match(/Question ·/g) || []).length, 1);
ask.setExpanded(true);
assert.match(paint(ask), /Answer\s*\n +MacBook/);
assert.doesNotMatch(paint(ask), /1\. ask_user_question/);
capture('Answered question opened directly with readable answer', ask);
ask.setExpanded(false);
for (const [status, expected, isError] of [['unavailable', 'Unavailable', false], ['cancelled', 'Cancelled', false], ['answered', 'Unanswered', false], ['failed', 'Failed', true]]) {
  ask.updateResult({ ...result('No recorded answer', { question: 'Which host?', status, answers: [] }), isError });
  assert.match(paint(ask), new RegExp(`Question · ${expected}`));
  assert.doesNotMatch(paint(ask), /MacBook/, 'prior answers cannot leak into a later unresolved interaction');
  ask.setExpanded(true);
  assert.match(paint(ask), new RegExp(`Answer\\s*\\n +${expected}`), 'answer section shows the recorded unresolved state');
  assert.doesNotMatch(paint(ask), /MacBook|Arguments|Details|Output/);
  assert.match(paint(ask), /No recorded answer/, 'unresolved question retains its readable recorded message');
  ask.setExpanded(false);
}
ask.updateResult(result('unnecessary raw output', { status: 'unavailable', question: 'Which host?', message: 'Question UI is unavailable in this session.' }));
ask.setExpanded(true);
assert.match(paint(ask), /Question UI is unavailable in this session/);
assert.doesNotMatch(paint(ask), /unnecessary raw output|Arguments|Details|Output/);
ask.setExpanded(false);
const detailedArgs = { question: 'Choose a host?', details: 'Use the machine that owns the checkout.', options: [
  { label: 'MacBook (Recommended)', value: 'mac', description: 'Use the local checkout.' },
  { label: 'CCC', value: 'ccc' },
] };
const detailedResult = result('User selected: 1. MacBook (Recommended)', { status: 'answered', question: detailedArgs.question, context: detailedArgs.details, mode: 'single-select', answers: [{ type: 'option', index: 1, label: 'MacBook (Recommended)', value: 'mac' }] });
const detailedSource = JSON.stringify({ args: detailedArgs, result: detailedResult });
const detailedAsk = make('ask_user_question', 'q-details', detailedArgs);
detailedAsk.updateResult(detailedResult); detailedAsk.setExpanded(true);
assert.match(paint(detailedAsk), /Question\s*\n +Choose a host/);
assert.match(paint(detailedAsk), /Options\s*\n +1\. MacBook \(Recommended\)/);
assert.match(paint(detailedAsk), /Use the local checkout/);
assert.doesNotMatch(paint(detailedAsk), /1\. ask_user_question/);
capture('Detailed question with recorded options and descriptions', detailedAsk);
const scrollQuestion = () => detailedAsk.handleMouse({ type: 'wheel', button: 'none', wheelDelta: 4, x: 2, y: 3, screenX: 2, screenY: 3, width: 120, height: detailedAsk.render(120).length, shift: false, alt: false, ctrl: false });
scrollQuestion();
assert.match(paint(detailedAsk), /Answer\s*\n +1\. MacBook \(Recommended\)/, 'structured option answers use their recorded labels and indices');
capture('Detailed question scrolled to recorded answer', detailedAsk);
scrollQuestion();
assert.doesNotMatch(paint(detailedAsk), /Arguments|Details|Output|mode:|value:/, 'question history omits raw duplicate records');
assert.equal(JSON.stringify({ args: detailedArgs, result: detailedResult }), detailedSource, 'question presentation preserves all stored source');
let laterOptionReads = 0;
const lazyOptions = [{ label: 'Large recorded option '.repeat(100000) }];
Object.defineProperty(lazyOptions, 1, { enumerable: true, get() { laterOptionReads++; return { label: 'Later choice' }; } });
const lazyAsk = make('ask_user_question', 'q-lazy', { question: 'Which recorded option?', options: lazyOptions });
lazyAsk.setExpanded(true); lazyAsk.render(40);
assert.equal(laterOptionReads, 0, 'a long first option does not read later choices while painting one viewport');
lazyAsk.setExpanded(false);
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
assert.equal(mouseAt(mouseFirst, 'wheel', 1, { wheelDelta: 3 }), undefined, 'closed pane preserves transcript wheel scrolling');
assert.equal(mouseAt(mouseFirst, 'click', 1, { x: -1 }).handled, true);
assert.equal(input('\x1b[A'), undefined, 'outside x suppresses native toggle without focus');
assert.equal(mouseAt(mouseFirst, 'click', 1).handled, true, 'single summary header opens details');
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
mouseAt(mouseFirst, 'click', 1);
assert.doesNotMatch(paint(mouseFirst), /1\. read/, 'group header closes the inline pane');
input('\x1b');
assert.equal(input('\x1b[A'), undefined);
assert.equal(mouseAt(mouseFirst, 'click', 10000), undefined);
// Replay script-shaped shell fallbacks without running any command.
const nodeScripts = [
  `node -e 'const paths = ["/fixture/a", "/fixture/b"]; console.log(paths.map(path => ({ path })));'`,
  `node - <<'NODE'\nconst paths = ["/fixture/a", "/fixture/b"];\nconsole.log(paths.map(path => ({ path })));\nNODE`,
];
for (const command of nodeScripts) {
  assert.equal(toolLabel('bash', { command }), 'bash · Run Node.js script');
  assert.doesNotMatch(toolLabel('bash', { command }), /paths|fixture|console|codemode/);
}
assert.equal(toolLabel('bash', { command: 'node --version' }), 'bash · node --version', 'non-script interpreter operations stay truthful');
assert.equal(toolLabel('bash', { command: 'python3 -c "print(1)"' }), 'bash · Run Python script');
assert.equal(toolLabel('bash', { command: 'node /fixture/check.mjs' }), 'bash · Run Node.js script · /fixture/check.mjs');
assert.ok(toolLabel('bash', { command: 'custom-command ' + 'x'.repeat(10000) }).length < 80);
event('message_end', { message: { role: 'user', content: 'synthetic script replay' } });
const scripted = make('bash', 'script-label', { command: nodeScripts[1] });
scripted.updateResult(result('# literal stdout **unchanged** _log_\nSynthetic script output', { exitCode: 0 }));
assert.equal(paint(scripted).trim(), '▸ bash · Run Node.js script');
assert.doesNotMatch(paint(scripted), /successful|Completed|✓|const paths/);
scripted.setExpanded(true);
let scriptPaint = scripted.render(120).join('\n');
assert.match(stripAnsi(scriptPaint), /const paths/);
assert.match(stripAnsi(scriptPaint), /# literal stdout \*\*unchanged\*\* _log_/, 'Bash stdout remains literal');
assert.ok(scriptPaint.includes(themeModule.theme.getFgAnsi('syntaxKeyword')), 'heredoc source uses native JavaScript keyword colors');
scripted.setExpanded(false);
const exactError = `Error: ENAMETOOLONG: name too long, lstat '${'\"/fixture/very-long-path\",'.repeat(10000)}'`;
const scriptFailure = make('bash', 'script-failure', { command: nodeScripts[0] });
const failureRecording = { ...result(exactError, { error: exactError, exitCode: 1 }), isError: true };
scriptFailure.updateResult(failureRecording);
assert.equal(paint(scriptFailure).trim(), '▸ bash · Run Node.js script · ✗ Failed · Path too long');
assert.ok(paint(scriptFailure, 500).trim().length < 100);
scriptFailure.setExpanded(true);
assert.match(paint(scriptFailure), /ENAMETOOLONG: name too long, lstat/);
const styled = new ToolPane([{ id: 'styles', label: 'read', sections: function* () {
  yield { text: '# Recorded heading\n**Emphasis** and `inline` code.\n```javascript\nconst paths = ["/fixture/a"];\n```', format: 'markdown' };
  yield { text: '-const before = 1;\n+const after = 2;', format: 'code', language: 'diff' };
} }], 'Styles', () => 20);
styled.open = true; styled.theme = themeModule.theme;
const styledRows = styled.render(120).join('\n');
assert.match(stripAnsi(styledRows), /Recorded heading/);
assert.doesNotMatch(stripAnsi(styledRows), /# Recorded heading|\*\*Emphasis\*\*/);
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('syntaxKeyword')), 'fenced code uses native syntax colors');
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('syntaxString')), 'code strings use their native token color');
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('toolDiffAdded')), 'diff additions use native highlighting');
assert.equal(failureRecording.content[0].text, exactError, 'expanded formatting leaves exact recorded output unchanged');
assert.equal(failureRecording.details.error, exactError, 'expanded formatting leaves exact recorded details unchanged');
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
  toggle(true); assert.match(paint(resumed), /read · \/tmp\/resumed/);
  event('session_compact'); event('session_tree');
  toggle(false);
  const shutdownRunning = make('bash', 'clock-shutdown', { command: 'printf safe' });
  shutdownRunning.markExecutionStarted(); shutdownRunning.updateResult(result('partial', { calls: [] }), true);
  assert.equal(intervals.size, 1, 'wrapped tools retain the native timer contract');
  dispose(); dispose(); assert.equal(intervals.size, 0); assert.equal(input, undefined); assert.equal(modeChange, undefined);
} finally { for (const handle of intervals) actualClearInterval(handle); globalThis.setInterval = actualSetInterval; globalThis.clearInterval = actualClearInterval; }
// A 10 MB output is not eagerly split or painted. Stored source remains unchanged.
const huge = '漢字🙂 exact\x1b[31m\n'.repeat(400000);
const simplePane = new ToolPane([{ id: 'simple', label: 'read · exact.txt', sections: function* () { yield { text: 'Output', kind: 'section' }; yield 'exact output'; } }], '1 successful action', () => 20);
simplePane.theme = themeModule.theme; simplePane.open = true; simplePane.expanded.add('simple');
const simpleRows = simplePane.render(80);
assert.equal(simpleRows.length, 3, 'an unfocused complete pane has no footer row');
assert.doesNotMatch(stripAnsi(simpleRows.join('\n')), /to inspect|Alt\+G|more ↓/);
assert.doesNotMatch(stripAnsi(simpleRows.join('\n')), /1\. read/, 'a singleton has no duplicate action heading');
assert.equal(stripAnsi(simpleRows.find(row => stripAnsi(row).includes('exact output'))).indexOf('exact output'), 3, 'singleton details align after the disclosure column');
assert.ok(simpleRows.find(row => stripAnsi(row).trim() === 'Output').includes(themeModule.theme.getFgAnsi('muted')), 'section headings use the native muted color');
const singleRound = new ToolPane([{ id: 'round', label: 'Recorded first line', sections: function* () { yield 'Full recorded round'; } }], 'Thinking · 1 round');
singleRound.itemName = 'round'; singleRound.open = true;
assert.match(stripAnsi(singleRound.render(80).join('\n')), /1\. Recorded first line/);
assert.doesNotMatch(stripAnsi(singleRound.render(80).join('\n')), /Full recorded round/);
singleRound.handle('\r');
assert.match(stripAnsi(singleRound.render(80).join('\n')), /Full recorded round/, 'single thinking rounds keep independent expansion');
const exactValues = { command: 'printf "hello"\nnext exact line', options: { paths: ['a', 'b'], empty: '', nullable: null } };
const valueRows = [...recordedValues(exactValues)];
assert.ok(valueRows.some(row => row.text === exactValues.command), 'multiline string values remain exact');
assert.ok(valueRows.some(row => row.text === '[1]:') && valueRows.some(row => row.text === 'b'), 'array positions and values remain accessible');
assert.ok(valueRows.some(row => row.text === '""') && valueRows.some(row => row.text === 'nullable: null'), 'empty strings and null remain distinct');
let laterFieldReads = 0;
const largeArguments = { command: huge };
Object.defineProperty(largeArguments, 'later', { enumerable: true, get() { laterFieldReads++; return 'later recorded value'; } });
const argumentPane = new ToolPane([{ id: 'args', label: 'bash', sections: () => recordedValues(largeArguments) }], 'Arguments', () => 8);
argumentPane.open = true; argumentPane.expanded.add('args'); argumentPane.render(30);
assert.equal(laterFieldReads, 0, 'painting a large argument does not visit later fields');
assert.equal(largeArguments.command, huge, 'argument formatting does not change stored source');
assert.equal([...textRows('\x1b[31m\u202eexact\u{e0001}', 80)].join(''), '\\u001b[31m\\u202eexact\\u{e0001}', 'terminal and bidi controls are visible text');
// Compact summaries retain the native gutter without colored Box padding.
const referencePane = new ToolPane([], 'Ref'); referencePane.theme = themeModule.theme;
for (const width of [8, 30, 80]) {
  const rows = referencePane.render(width);
  assert.equal(rows.length, 1); assert.match(stripAnsi(rows[0]), /^ ▸ Ref/); assertNeutral(rows);
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
assert.match(paint(retainedRows[0]), /2 actions/);
assert.equal(paint(retainedRows[1]), '');
event('session_compact'); assert.match(paint(retainedRows[0]), /2 actions/);
// Old native rows are stale after rebuild; newly replayed rows use the retained projection again.
const replayed = make('read', 'retained-1', recordedArgs[1]); replayed.updateResult(result('retained output 1'));
assert.match(paint(replayed), /2 actions/);
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
if (process.env.PI_CARD_EVIDENCE_PATH) writeFileSync(process.env.PI_CARD_EVIDENCE_PATH, JSON.stringify({ runtime, evidence }, null, 2) + '\n');
console.log('modern tools: native lifecycle, grouping, questions, focus and bounded output passed');
