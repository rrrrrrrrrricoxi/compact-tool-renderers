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
  assert.match(paint(code), /▸ codemode · 2 nested calls · 1 nested error · 0.75s/);
  assert.doesNotMatch(paint(code), /✓|Completed/, 'successful code-mode summary omits redundant status');
  assert.doesNotMatch(paint(code), /✗ Failed|Recorded script output|Recorded nested failure/);
  assert.equal(toolStatus('codemode', final).status, 'success', 'handled nested errors do not fail the script');
  const header = code.render(140).find(row => stripAnsi(row).includes('nested error'));
  assert.ok(header.includes(themeModule.theme.getFgAnsi('warning')), 'nested failure warns on a completed script');
  assert.ok(backgroundCells(header).every(value => value === ''), 'collapsed summary uses neutral terminal surface');
  code.setExpanded(true);
  const pane = code.callRendererComponent.owner.code;
  assert.equal(pane.content.supported, true);
  assert.ok(code.render(140).some(row => row.includes(themeModule.theme.getFgAnsi('syntaxKeyword'))), 'native keyword colors remain');
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
 // Giant fixtures count actual formatted characters/calls, separately from revision aggregation.
 const hugeScript = 'const paths = ["/fixture/a", "/fixture/b"];\n'.repeat(250000);
 const hugeOutput = 'stdout value 中文🙂 '.repeat(400000);
 const hugeCalls = Array.from({length: 20000}, (_, index) => ({name:'read',args:`/fixture/${index}`,status:'ok',durationMs:1}));
 Object.defineProperty(hugeCalls[19999], 'irrelevant', {get(){throw new Error('unused metadata getter must not be visited');}});
 const huge = create('codemode', 'bounded-giant', {code:hugeScript}, codemodeRenderers);
 const hugeResult = {content:[{type:'text',text:hugeOutput}],details:{calls:hugeCalls},durationMs:81234};
 huge.updateResult(hugeResult);
 const giantPane = huge.callRendererComponent.owner.code;
 assert.equal(giantPane.content.sourceCharacters,0,'collapsed construction/update formats zero source characters');
 assert.equal(giantPane.content.paintedCalls,0,'collapsed construction/update formats zero nested calls');
 assert.equal(giantPane.content.aggregateEntries,20000,'one aggregate pass for the result revision');
 for(let i=0;i<3;i++){huge.invalidate();huge.render(100);}
 assert.equal(giantPane.content.aggregateEntries,20000,'redraw/invalidation does not rescan nested-call aggregate');
 huge.setExpanded(true);huge.render(100);
 assert.ok(giantPane.content.sourceCharacters<=2048,'first viewport formats only bounded source chunks, not the 10 MB script');
 assert.equal(giantPane.content.paintedCalls,0,'viewport does not visit later nested calls');
 const initialCharacters=giantPane.content.sourceCharacters;
 huge.render(100);huge.render(100);assert.equal(giantPane.content.sourceCharacters,initialCharacters,'repeated paint uses visited row cache');
 huge.invalidate();huge.render(100);assert.equal(giantPane.content.sourceCharacters,initialCharacters,'unchanged native invalidation preserves body cache');
 const beforeAggregate=giantPane.content.aggregateEntries;
 hugeCalls[0].status='error';hugeCalls[0].error='in-place recorded error';
 event('tool_execution_update',{toolCallId:'bounded-giant',toolName:'codemode',args:{code:hugeScript},partialResult:hugeResult});
 huge.updateResult(hugeResult,true);
 assert.equal(giantPane.content.errors,1,'explicit update revision detects in-place status mutation');
 assert.equal(giantPane.content.aggregateEntries-beforeAggregate,20000,'in-place update aggregates once, not once per renderer slot');
 hugeCalls.push({name:'read',args:'/fixture/new',status:'cancelled'});
 event('tool_execution_update',{toolCallId:'bounded-giant',toolName:'codemode',args:{code:hugeScript},partialResult:hugeResult});huge.updateResult(hugeResult,true);
 assert.equal(giantPane.content.calls.length,20001);assert.equal(giantPane.content.cancelled,1,'same array identity can gain a cancelled call');
 huge.updateResult(hugeResult); // No execution start, so this synthetic partial replay owns no clock.
 const stdoutOnly=create('codemode','bounded-stdout',{code:''},codemodeRenderers);stdoutOnly.updateResult({content:[{type:'text',text:hugeOutput}],details:{calls:[]}});stdoutOnly.setExpanded(true);stdoutOnly.render(100);
 assert.ok(stdoutOnly.callRendererComponent.owner.code.content.sourceCharacters<=2048,'giant stdout has bounded formatting');
 const hugeError=create('codemode','bounded-nested-error',{code:'text(1);'},codemodeRenderers);
 hugeError.updateResult({content:[],details:{calls:[{name:'read',args:'/fixture',status:'error',error:'recorded error '.repeat(500000)}]}});hugeError.setExpanded(true);hugeError.render(100);
 assert.ok(hugeError.callRendererComponent.owner.code.content.sourceCharacters<=4096,'giant nested errors are chunked too');
 const tailCalls=Array.from({length:80},(_,index)=>({name:'read',args:`tail-call-${index}`,status:'ok'}));
 const tailRecord={content:[{type:'text',text:'tail-output-start\n'+('recorded output row\n'.repeat(70))+'LAST-OUTPUT🙂'}],details:{calls:tailCalls,fullOutputPath:'/fixture/exact-full-output.log'}};
 const tailBefore=JSON.stringify(tailRecord);
 const tail=create('codemode','bounded-tail',{code:('const value = 1;\n'.repeat(80))+'// LAST-SOURCE🙂'},codemodeRenderers);tail.updateResult(tailRecord);tail.setExpanded(true);
 const tailPane=tail.callRendererComponent.owner.code;let visited=paint(tail);
 for(let i=0;i<100;i++){tailPane.offset+=10;visited+='\n'+paint(tail);}
 for(const text of ['LAST-SOURCE🙂','tail-call-79','LAST-OUTPUT🙂','/fixture/exact-full-output.log'])assert.ok(visited.includes(text),`all recorded sections remain reachable: ${text}`);
 assert.equal(JSON.stringify(tailRecord),tailBefore,'full traversal leaves original record unchanged');
 const safe=create('codemode','bounded-unicode',{code:'const 中文 = "🙂";\n// \u202e'},codemodeRenderers);safe.updateResult(result('exact\x1b[31m\u202e\u0000end'));safe.setExpanded(true);
 const safeText=paint(safe);assert.match(safeText,/\\u001b\[31m\\u202e\\u0000end/);assert.doesNotMatch(safeText,/\u202e/);
 for(const width of [1,2,8,40])for(const line of safe.render(width))assert.ok(tui.visibleWidth(line)<=width);
 const replay=create('codemode','bounded-duration-replay',{code:''},codemodeRenderers);replay.updateResult({content:[{type:'text',text:'Script completed\nWall time 73.25 seconds\nOutput:\n'},{type:'text',text:'replay output'}],details:{calls:[]}});replay.setExpanded(true);
 assert.match(paint(replay),/Wall time 73.25 seconds/,'replay without duration keeps its recorded envelope');
 replay.updateResult({...result('replay output'),durationMs:73250});assert.match(paint(replay),/Took 1m 13s/,'duration retains seconds above one minute');
 const themeFixture=create('codemode','bounded-theme',{code:'const themeValue = 1;'},codemodeRenderers);themeFixture.updateResult(result('theme output'));themeFixture.setExpanded(true);themeFixture.render(140);
 const themePane=themeFixture.callRendererComponent.owner.code, themed=themePane.content.sourceCharacters;
 const activeTheme=globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")], originalFg=activeTheme.fg;
 try{
  activeTheme.fg=function(token,text){return ['toolOutput','syntaxKeyword'].includes(token)?'\x1b[38;5;201m'+text+'\x1b[39m':originalFg.call(this,token,text);};
  themeFixture.invalidate();assert.ok(themeFixture.render(140).some(row=>row.includes('\x1b[38;5;201m')),'theme mutation invalidates cached ANSI');
  assert.ok(themePane.content.sourceCharacters>themed);
 }finally{activeTheme.fg=originalFg;themeFixture.invalidate();}
 const emptyBlocks=Array.from({length:100000},()=>({type:'text',text:''}));emptyBlocks.push({type:'text',text:'nonempty tail output'});
 const empties=create('codemode','bounded-empty-blocks',{code:''},codemodeRenderers);empties.updateResult({content:emptyBlocks,details:{calls:[]}});
 const emptyPane=empties.callRendererComponent.owner.code;
 assert.equal(emptyPane.content.aggregateBlocks,100001,'empty block indexing is once-per-update work');
 empties.setExpanded(true);assert.match(paint(empties),/nonempty tail output/);
 assert.equal(emptyPane.content.aggregateBlocks,100001,'paint does not rescan empty output blocks');
 assert.ok(emptyPane.content.sourceCharacters<100,'only the visible nonempty output is formatted');
 // Nontext/new native shapes use stock rendering, including both native slots.
 const preFallbackChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>preFallbackChoices.push(choice)});
 const image=create('codemode','bounded-image-fallback',{code:'text("image");'},codemodeRenderers);image.updateResult({content:[{type:'image',mimeType:'image/png',data:''}],details:{calls:[]}});
 assert.doesNotMatch(paint(image),/▸ codemode/,'unsupported nontext result retains native fallback');
 assert.match(paint(image),/image\/png|image/);
 const fallbackChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>fallbackChoices.push(choice)});
 assert.equal(fallbackChoices.length,preFallbackChoices.length,'unsupported native fallback is absent from compact inspector');
 image.updateResult(result('supported again'));image.setExpanded(true);
 assert.match(paint(image),/supported again/,'fallback to supported is visible immediately');assert.doesNotMatch(paint(image),/image\/png/);
 image.updateResult({content:[{type:'image',mimeType:'image/png',data:''}],details:{calls:[]}});assert.match(paint(image),/image/,'supported to native fallback is visible immediately');
 image.updateResult(result('supported again'));
 const restoredChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>restoredChoices.push(choice)});
 assert.ok(restoredChoices.length>fallbackChoices.length,'supported result restores compact inspection');

 const unsupported=create('codemode','bounded-invalid-fallback',{code:42},codemodeRenderers);assert.match(paint(unsupported),/invalid arg/);
 // Replay preserves script boundaries between adjacent successes.
 const replayFirst = create('read', 'replay-before', { path: '/fixture/replay-before' }, readRenderers); replayFirst.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'replay-code', name: 'codemode', arguments: { code: 'text(1)' } }] } });
 const replayCode = create('codemode', 'replay-code', { code: 'text(1)' }, codemodeRenderers); replayCode.updateResult(result('done'));
 const last = create('read', 'after-code', { path: '/fixture/after' }, readRenderers); last.updateResult(result('last'));
 assert.match(paint(last), /read · \/fixture\/after/); assert.doesNotMatch(paint(last), /2 actions/);
 assert.doesNotMatch(paint(replayCode), /successful action/);
 assert.match(paint(replayFirst), /read · \/fixture\/replay-before/); assert.doesNotMatch(paint(replayFirst), /2 actions/);
 console.log('codemode: collapsed summary, bounded native-style details, nested outcome, timer, mouse/inspection/editor/Ctrl+O, viewport and transcript checks passed');
} finally { dispose(); }
