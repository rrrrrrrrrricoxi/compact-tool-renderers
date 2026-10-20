import assert from 'node:assert/strict';
import { backgroundCells, core, loadSource, stripAnsi, themeModule, tui } from './test-runtime.mjs';

const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { projectedChildren, renderFinalReply, workEvidenceType } = await loadSource('./work-strip-view.ts');
const replyText = 'FINAL **bold** and `code`\n\nSecond paragraph.\n\n- First item\n- Second item';
const message = (text = replyText, stopReason = 'stop') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason });
const token = theme => backgroundCells(theme.bg('toolPendingBg', ' '))[0];
const cells = line => backgroundCells(line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ''));
const withoutZones = line => line.replace(/\x1b\]133;[ABC]\x07/g, '');
const paddedNativeText = (native, width, first = 1, last = native.length - 1) => [
  ...native.slice(0, first).map(stripAnsi), ' '.repeat(width),
  ...native.slice(first, last + 1).map(stripAnsi), ' '.repeat(width), ...native.slice(last + 1).map(stripAnsi),
];
function assertReplySurface(lines, theme) {
  assert.equal(cells(lines[0]).length, 0, 'native leading spacer has no filled cells');
  assert.ok(!/\x1b\[(?:48|4[0-7]|10[0-7])/.test(lines[0]), 'leading spacer is not tinted');
  for (const line of lines.slice(1)) {
    assert.ok(cells(line).length > 0, 'reply paragraphs and internal gaps retain native width');
    assert.ok(cells(line).every(cell => cell === token(theme)), 'neutral surface survives nested Markdown resets');
  }
}

// The native component owns wrapping, Markdown, OSC zones and the leading gap.
// Add exactly two padding rows; keep native reply wrapping and narrow overflow.
for (const appearance of ['dark', 'light']) {
  themeModule.initTheme(appearance, false);
  const theme = themeModule.theme;
  const row = new core.AssistantMessageComponent(message(), true);
  const markdown = row.contentContainer.children.find(child => child instanceof tui.Markdown);
  const originalRender = markdown.render;
  const ownRender = Object.getOwnPropertyDescriptor(markdown, 'render');
  for (const width of [1, 7, 30, 100]) {
    const native = row.render(width), painted = renderFinalReply(row, width, theme);
    assert.deepEqual(painted.map(stripAnsi), paddedNativeText(native, width), `only two filled padding rows are added at width ${width}`);
    assertReplySurface(painted, theme);
    assert.deepEqual(painted.join('\n').match(/\x1b\]133;[ABC]\x07/g), native.join('\n').match(/\x1b\]133;[ABC]\x07/g), 'native OSC zones remain exact');
    assert.equal(markdown.render, originalRender);
    assert.deepEqual(Object.getOwnPropertyDescriptor(markdown, 'render'), ownRender, 'render projection restores the native property shape');
  }
}

// Image payloads and their cursor controls must pass through byte for byte.
{
  const row = new core.AssistantMessageComponent(message('Image placeholder.'), true);
  const markdown = row.contentContainer.children.find(child => child instanceof tui.Markdown);
  const imageLines = ['\x1b_Ga=T,f=100;AAAA\x1b\\', '\x1b[2A\x1b]1337;File=inline=1:AAAA\x07'];
  markdown.render = () => [...imageLines];
  const rendered = renderFinalReply(row, 40, themeModule.theme);
  assert.deepEqual(rendered.slice(2, -1).map(withoutZones), imageLines, 'graphics payloads stay exact between the added padding rows');
  assert.deepEqual(rendered.join('\n').match(/\x1b\]133;[ABC]\x07/g), row.render(40).join('\n').match(/\x1b\]133;[ABC]\x07/g), 'native OSC zones include the padded reply');
  markdown.render = () => { throw new Error('synthetic Markdown failure'); };
  const render = markdown.render;
  assert.throws(() => renderFinalReply(row, 40, themeModule.theme), /synthetic Markdown failure/);
  assert.equal(markdown.render, render, 'a failed native render also restores the method');
}

// Multiple text blocks share one padding pair. A later thinking region keeps
// its native mouse target after the added top row shifts its screen position.
{
  const row = new core.AssistantMessageComponent({ role: 'assistant', stopReason: 'stop', content: [
    { type: 'text', text: 'FIRST_TEXT_BLOCK' }, { type: 'thinking', thinking: 'CLICKED_NATIVE_THINKING' },
    { type: 'text', text: 'SECOND_TEXT_BLOCK' },
  ] }, true);
  const native = row.render(60), children = [...row.contentContainer.children];
  const rendered = renderFinalReply(row, 60, themeModule.theme);
  const first = native.findIndex(line => stripAnsi(line).includes('FIRST_TEXT_BLOCK'));
  const last = native.findIndex(line => stripAnsi(line).includes('SECOND_TEXT_BLOCK'));
  assert.deepEqual(rendered.map(stripAnsi), paddedNativeText(native, 60, first, last), 'multiple native text blocks receive exactly one padding pair');
  assert.deepEqual(row.contentContainer.children, children, 'padded rendering restores native child identity and order');
  const y = rendered.findIndex(line => stripAnsi(line).includes('Thinking'));
  assert.ok(row.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 60, height: rendered.length, screenX: 2, screenY: y })?.handled, 'native container maps a thinking click shifted by top padding');
  assert.match(stripAnsi(renderFinalReply(row, 60, themeModule.theme).join('\n')), /CLICKED_NATIVE_THINKING/);
}

function fixture() {
  const hooks = new Map(), bus = new Map(), commands = new Map();
  const subscribe = (map, name, fn) => {
    const set = map.get(name) || new Set(); map.set(name, set); set.add(fn); return () => set.delete(fn);
  };
  const manager = core.SessionManager.inMemory('/synthetic-final-surface');
  const pi = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: (name, fn) => subscribe(bus, name, fn), emit(name, value) { for (const fn of [...bus.get(name) || []]) fn(value); } },
    getAllTools: () => [], appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
    registerCommand: (name, definition) => commands.set(name, definition),
  };
  const mode = createDisplayMode(), dispose = registerWorkStrip(pi, mode);
  const ui = { theme: themeModule.theme, isFollowingOutput: true, requestRender() {} };
  const ctx = { mode: 'tui', hasUI: true, ui, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui, pendingTools: new Map(), outputPad: 1,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: { getMessageRenderer() {} } },
    getUserMessageText: value => value.content,
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(), getMarkdownTransformers: () => [],
    editor: { addToHistory() {} },
  };
  const event = (name, value = {}) => { for (const fn of [...hooks.get(name) || []]) fn(value, ctx); };
  const add = value => {
    value.timestamp ??= 1000 + manager.getBranch().length;
    manager.appendMessage(value);
    const entry = manager.getBranch().at(-1);
    core.InteractiveMode.prototype.addMessageToChat.call(display, value);
    return { row: display.chatContainer.children.at(-1), entry };
  };
  const tool = () => {
    const row = new core.ToolExecutionComponent('read', 'surface-read', {}, { outputPad: 1 }, undefined, ui, '/synthetic-final-surface');
    row.setArgsComplete(); row.updateResult({ content: [{ type: 'text', text: 'READ_RESULT' }], isError: false });
    display.chatContainer.addChild(row); return row;
  };
  const paint = () => display.chatContainer.render(60);
  const view = row => { paint(); return display.chatContainer[projectedChildren].find(item => item === row || item.children?.[0] === row); };
  return { add, tool, event, emit: pi.events.emit, paint, view, mode, dispose, ui, display, manager, ctx, commands };
}

// A direct answer gets a final surface without introducing a Work header.
{
  const f = fixture();
  try {
    f.add({ role: 'user', content: 'Answer directly.' });
    const commentary = f.add(message('Intermediate reply.'));
    const final = f.add(message());
    const canonical = [...f.display.chatContainer.children], native = final.row.render(60);
    const transcript = JSON.stringify(f.manager.getBranch());
    f.event('session_start'); f.paint();
    assert.equal(f.view(commentary.row), commentary.row, 'earlier commentary stays plain');
    assert.ok(!f.display.chatContainer[projectedChildren].some(row => row.constructor.name === 'WorkStripHeader'));
    const surface = f.view(final.row);
    assert.notEqual(surface, final.row);
    assertReplySurface(surface.render(60), f.ui.theme);
    assert.deepEqual(surface.render(60).map(stripAnsi), paddedNativeText(native, 60));
    const dark = surface.render(60);
    themeModule.initTheme('dark', false); f.ui.theme = themeModule.theme;
    const changed = f.view(final.row).render(60);
    assert.notDeepEqual(changed, dark, 'the cached final view reads the current theme');
    assertReplySurface(changed, f.ui.theme);
    f.mode.setEnabled(false);
    assert.deepEqual(f.paint(), canonical.flatMap(row => row.render(60)), 'compact-off retains native bytes');
    f.mode.setEnabled(true); f.paint();
    assert.deepEqual(f.display.chatContainer.children, canonical);
    assert.equal(JSON.stringify(f.manager.getBranch()), transcript, 'direct final styling adds no transcript metadata');
  } finally { f.dispose(); f.mode.dispose(); }
}

// A stop reason alone cannot turn a live intermediate response into a final.
for (const stopReason of ['stop', 'toolUse', 'error', 'aborted', 'length']) {
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Live response.' });
    const final = f.add(message('LIVE_REPLY', stopReason));
    assert.equal(f.view(final.row), final.row, 'live replies retain native rendering before settlement');
    f.event('agent_settled');
    assert.equal(f.view(final.row) !== final.row, stopReason !== 'toolUse', 'only a settled terminal reply receives a surface');
    assert.match(stripAnsi(f.paint().join('\n')), /LIVE_REPLY/, 'terminal errors and interruptions retain their reply');
    const failure = { error: 'Error: Unknown error', aborted: 'Operation aborted', length: 'Response was truncated before completion.' }[stopReason];
    if (failure) assert.ok(stripAnsi(f.paint().join('\n')).includes(failure), 'native failure details remain distinct and visible');
    final.row.isStreaming = true;
    assert.equal(f.view(final.row), final.row, 'a streaming component is never styled as settled');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Execution commentary keeps one gutter through streaming and later replies.
// Only the settled terminal reply moves out of the work section.
{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Follow the live reply lifecycle.' });
    const first = f.add(message('FIRST_LIVE_COMMENTARY')).row;
    assert.equal(f.view(first), first, 'commentary alone does not introduce a work section');
    f.tool();
    const firstView = f.view(first);
    assert.equal(firstView.constructor.name, 'WorkChild', 'execution activity indents the current commentary immediately');
    assert.match(stripAnsi(firstView.render(60).join('\n')), /\n   FIRST_LIVE_COMMENTARY/);
    const nextMessage = message('NEXT_LIVE_COMMENTARY');
    f.event('message_start', { message: nextMessage });
    const next = f.add(nextMessage).row;
    next.updateContent(nextMessage, true);
    assert.equal(f.view(first), firstView, 'a newer reply does not shift the preceding commentary');
    const nextView = f.view(next);
    assert.equal(nextView.constructor.name, 'WorkChild', 'streaming commentary uses the same child gutter');
    next.updateContent(nextMessage, false); f.event('message_end', { message: nextMessage });
    assert.equal(f.view(next), nextView, 'message_end and stop alone do not promote commentary');
    const canonical = [...f.display.chatContainer.children];
    f.mode.setEnabled(false);
    assert.deepEqual(f.paint(), canonical.flatMap(row => row.render(60)), 'compact-off keeps native live rendering byte for byte');
    f.mode.setEnabled(true);
    assert.equal(f.view(next), nextView, 'compact-on restores the same commentary gutter');

    const finalMessage = message('CONFIRMED_FINAL_REPLY');
    f.event('message_start', { message: finalMessage });
    const final = f.add(finalMessage).row;
    final.updateContent(finalMessage, true);
    f.event('agent_settled');
    assert.equal(f.view(final).constructor.name, 'WorkChild', 'a streaming reply remains a work child even after agent settlement');
    final.updateContent(finalMessage, false); f.event('message_end', { message: finalMessage });
    const surface = f.view(final);
    assert.notEqual(surface.constructor.name, 'WorkChild', 'confirmed final reply leaves the work gutter');
    assertReplySurface(surface.render(60), f.ui.theme);
    assert.match(stripAnsi(surface.render(60).join('\n')), /\n CONFIRMED_FINAL_REPLY/);
    assert.equal(f.view(first), firstView, 'earlier commentary retains its gutter after final confirmation');
    assert.deepEqual(f.display.chatContainer.children, [...canonical, final], 'projection preserves the native child tree');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Parent settlement cannot style a reply as final while its descendants run.
{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Wait for the owned child.' }); f.tool();
    f.emit('subagent:async-started', { id: 'surface-child' });
    const final = f.add(message('WAITING_REPLY')).row;
    f.event('agent_settled');
    assert.equal(f.view(final).constructor.name, 'WorkChild', 'waiting reply remains inside the work section');
    assert.match(stripAnsi(f.paint().join('\n')), /Waiting/);
    f.emit('subagent:async-complete', { id: 'surface-child', state: 'complete', success: true });
    assertReplySurface(f.view(final).render(60), f.ui.theme);
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    f.add({ role: 'user', content: 'Tool call with commentary.' });
    const intermediate = message('Tool commentary.', 'stop');
    intermediate.content.push({ type: 'toolCall', id: 'surface-tool', name: 'read', arguments: {} });
    const row = f.add(intermediate).row;
    f.event('session_start');
    assert.equal(f.view(row).constructor.name, 'WorkChild', 'text accompanying a tool call stays inside the work section');
    assert.deepEqual(f.view(row).children, [row], 'tool-call text retains its native component');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Folding and unfolding use the same final surface at the native main margin.
{
  const f = fixture();
  try {
    const user = f.add({ role: 'user', content: 'Inspect a file.' });
    f.add(message('Checking the file.')); f.tool();
    const final = f.add({ role: 'assistant', stopReason: 'stop', content: [
      { type: 'thinking', thinking: 'Native thinking remains inspectable.' }, { type: 'text', text: 'FINAL_REPLY' },
    ] });
    f.manager.appendCustomEntry(workEvidenceType, {
      version: 1, userId: user.entry.id, finalId: final.entry.id, endId: final.entry.id,
      startedAt: 1000, endedAt: 2000, outcome: 'completed',
    });
    f.event('session_start');
    const folded = f.view(final.row).render(60);
    assert.equal(folded.length, 4, 'one outer gap and a three-row final card remain after thinking folds');
    assertReplySurface(folded, f.ui.theme);
    await f.commands.get('work').handler('expand', f.ctx);
    const surface = f.view(final.row), expanded = surface.render(60);
    assert.match(stripAnsi(expanded.join('\n')), /Thinking/);
    const thinkingIndex = expanded.findIndex(line => stripAnsi(line).includes('Thinking'));
    assert.ok(cells(expanded[thinkingIndex]).every(cell => !cell), 'native thinking stays on the plain surface');
    const finalLine = expanded.find(line => stripAnsi(line).includes('FINAL_REPLY'));
    assert.match(stripAnsi(finalLine), /^ FINAL_REPLY/, 'final text retains the native main margin');
    assert.ok(cells(finalLine).every(cell => cell === token(f.ui.theme)));
    const click = { type: 'click', button: 'left', x: 2, y: thinkingIndex, width: 60, height: expanded.length, screenX: 2, screenY: thinkingIndex };
    assert.ok(surface.handleMouse(click)?.handled, 'native thinking mouse coordinates remain valid');
    assert.match(stripAnsi(surface.render(60).join('\n')), /Native thinking remains inspectable/);
  } finally { f.dispose(); f.mode.dispose(); }
}

console.log('Final reply padded neutral card: native Markdown, one padding pair, outer gaps, resets, images, themes, settlement, direct replies, folding, mouse coordinates and compact-off passed');
