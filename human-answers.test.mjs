import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const { createJiti } = createRequire(`${root}/package.json`)('jiti');
const tuiPath = `${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti = createJiti(import.meta.url, { alias: {
  '@earendil-works/pi-tui': tuiPath, '@earendil-works/pi-coding-agent': `${root}/dist/index.js`,
  '@mariozechner/pi-tui': tuiPath, '@mariozechner/pi-coding-agent': `${root}/dist/index.js`,
  '@sinclair/typebox': `${root}/node_modules/typebox/build/index.mjs`,
} });
const { visibleWidth } = await import(pathToFileURL(tuiPath));
const { initTheme, theme: liveTheme, getMarkdownTheme } = await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const { AssistantMessageComponent } = await import(pathToFileURL(`${root}/dist/modes/interactive/components/assistant-message.js`));
const { ToolExecutionComponent } = await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const { humanAnswerRenderer, answeredDetails } = await jiti.import(new URL('./human-answers.ts', import.meta.url).pathname);
const { QuietGroups } = await jiti.import(new URL('./quiet-tools.ts', import.meta.url).pathname);
const extension = await jiti.import(new URL('./index.ts', import.meta.url).pathname, { default: true });
const installQuestion = await jiti.import('/Users/notrico/.pi/agent/extensions/ask-user-question.ts', { default: true });
let question;
installQuestion({ registerTool: tool => { question = tool; } });
// Actual installed formatter/execute with deterministic local UI, no terminal/models.
const fixture = async (args, reply, keys) => question.execute('fixture', args, undefined, undefined, {
  hasUI: true, ui: { editor: async () => reply, custom: async fn => {
    let answer;
    const c = fn({ requestRender() {} }, { fg: (_, s) => s }, {}, value => { answer = value; });
    for (const key of keys) c.handleInput(key);
    return answer;
  } },
});
const optionArgs = { question: 'Which route?', options: [{ label: 'Visible choice', value: 'machine_value' }] };
const selected = await fixture(optionArgs, null, ['\r']);
assert.equal(selected.details.answers[0].type, 'option');
const textArgs = { question: 'Your text?' };
const text = await fixture(textArgs, 'original text');
const empty = await fixture(textArgs, '');
const other = await fixture(optionArgs, null, ['\x1b[B', '\r', 'custom reply', '\r']);
assert.equal(other.details.answers[0].type, 'other');
const multiArgs = { ...optionArgs, question: 'Which routes?', multiSelect: true };
const multi = await fixture(multiArgs, null, ['\r', '\x1b[B', '\r', 'custom mixed', '\r', '\x1b[B', '\r']);
assert.equal(multi.details.answers.length, 2);
const cancelled = await fixture(textArgs, undefined);
const unavailable = await question.execute('fixture', textArgs, undefined, undefined, { hasUI: false });
const dir = mkdtempSync(join(tmpdir(), 'pi-human-answer-'));
const oldDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
try {
for (const mode of ['quiet', 'compact', 'expanded']) {
  writeFileSync(join(dir, 'compact-tool-renderers.json'), JSON.stringify({ mode }));
  let resolve; const hooks = new Map(); let branch = []; let redraws = 0;
  extension({ on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
    registerToolRenderer(fn) { resolve = fn; }, registerMarkdownTransformer() {}, registerCommand() {}, getCommands: () => [] });
  const ctx = { mode: 'tui', sessionManager: { getBranch: () => branch }, ui: { theme: liveTheme, setToolsExpanded() {}, setHiddenThinkingLabel() {} } };
  const emit = async (name, event) => { for (const fn of hooks.get(name) || []) await fn(event, ctx); };
  const call = (id, name, args = {}) => ({ type: 'toolCall', id, name, arguments: args });
  const batch = { role: 'assistant', content: [call('before', 'read'), call('q1', 'ask_user_question', optionArgs), call('between', 'read'), call('q2', 'ask_user_question', textArgs), call('after', 'read')] };
  const results = [selected, text].map((r, i) => ({ role: 'toolResult', toolCallId: `q${i + 1}`, toolName: 'ask_user_question', ...r, isError: false }));
  branch = [{ type: 'message', message: batch }, ...results.map(message => ({ type: 'message', message }))];
  const history = JSON.stringify(branch);
  await emit('session_start', {});
  const make = (id, args, result, name = 'ask_user_question') => {
    const native = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 2 }, { name, ...resolve(name, () => name === 'ask_user_question' ? question : undefined) }, { requestRender() { redraws++; } }, '/tmp');
    native.setArgsComplete(); native.markExecutionStarted();
    if (result) native.updateResult(result, false);
    return native;
  };
  for (const [args, result, heading, value] of [
    [optionArgs, selected, 'Selected option', 'Visible choice'], [optionArgs, other, 'Custom reply', 'custom reply'],
    [textArgs, text, 'Text reply', 'original text'], [textArgs, empty, 'Text reply', 'empty submitted text — not approval'],
    [multiArgs, multi, 'Multiple selections', 'Other: custom mixed'],
  ]) {
    const original = JSON.stringify({ args, result });
    const card = make('synthetic-' + heading, args, result);
    for (const palette of ['dark', 'light']) {
      initTheme(palette, false); card.invalidate();
      assert.match(card.render(120).join('\n'), new RegExp(`Your answer · ${heading}`));
      assert.ok(card.render(120).join('\n').includes(value));
      assert.ok(!card.render(120).join('\n').includes('machine_value'));
      for (const width of [1, 2, 3, 4, 10, 28, 80]) for (const line of card.render(width)) assert.ok(visibleWidth(line) <= width);
    }
    card.setExpanded(true); // Actual native Ctrl+O target.
    const expanded = card.render(120).join('\n');
    assert.match(expanded, /Original arguments \(JSON\)/);
    assert.match(expanded, /Recorded details \(JSON\)/);
    if (result === selected) assert.match(expanded, /machine_value/);
    card.setExpanded(false);
    card.render(120);
    assert.equal(card.handleMouse({ type: 'click', button: 'left', x: 3, y: 2, width: 120, height: 30 })?.handled, true);
    assert.match(card.render(120).join('\n'), /Recorded details/);
    assert.equal(JSON.stringify({ args, result }), original);
  }
  const q1 = make('q1', optionArgs, selected), q2 = make('q2', textArgs, text);
  assert.ok(q1.render(120).join('\n').includes('Which route?'));
  assert.ok(!q1.render(120).join('\n').includes('original text'));
  assert.ok(q2.render(120).join('\n').includes('Your text?'));
  assert.ok(!q2.render(120).join('\n').includes('Visible choice'));
  const ordinaryCards = ['before', 'between', 'after'].map(id => make(id, {}, { content: [{ type: 'text', text: 'ordinary result' }] }, 'read'));
  if (mode === 'quiet') for (const card of ordinaryCards) assert.match(card.render(120).join('\n'), /Tools · 1 call · read/);
  // Even identical question strings do not allow one call's result to leak.
  const sameQuestionReply = await fixture(optionArgs, null, ['\x1b[B', '\r', 'second call only', '\r']);
  const sameQuestion = make('q-same-question', optionArgs, sameQuestionReply);
  assert.match(sameQuestion.render(120).join('\n'), /second call only/);
  assert.ok(!q1.render(120).join('\n').includes('second call only'));
  for (const result of [cancelled, unavailable, { content: [{ type: 'text', text: 'failure' }], isError: true }, { ...text, details: { ...text.details, status: 'unknown' } }, { content: [{ type: 'text', text: 'unknown plain result' }] }]) {
    assert.ok(!make('fallback', textArgs, result).render(120).join('\n').includes('Your answer'));
  }
  const pending = make('pending', textArgs);
  assert.match(pending.render(120).join('\n'), /Question/);
  pending.updateResult(text, true);
  assert.ok(!pending.render(120).join('\n').includes('Your answer'));
  const longValue = '中文👩‍💻 é \x1b[31m\x1b]8;;bad\x07\t'.repeat(300) + '\nTAIL ORIGINAL';
  const long = await fixture(textArgs, longValue);
  const longCard = make('long', textArgs, long);
  for (const width of [1, 2, 3, 20, 80]) {
    const rows = longCard.render(width);
    assert.ok(rows.length <= 12, `${width}: ${rows.length}`);
    for (const row of rows) assert.ok(visibleWidth(row) <= width);
  }
  assert.ok(!longCard.render(80).join('\n').includes('TAIL ORIGINAL'));
  assert.match(longCard.render(80).join('\n'), /Ctrl\+O/);
  longCard.setExpanded(true);
  assert.match(longCard.render(80).join('\n'), /TAIL ORIGINAL/);
  assert.ok(!longCard.render(80).join('\n').includes('\x1b]8;;bad'));
  const multiline = await fixture(textArgs, 'first\n\nthird\nlast');
  assert.match(make('multiline', textArgs, multiline).render(120).join('\n').replace(/\x1b\[[0-9;]*m/g, ''), /first\n {2}\n {2}third/);
  assert.equal(JSON.stringify(branch), history);
  // Thinking panes must not move reasoning across the visible human surface.
  const round = id => ({ role: 'assistant', content: [{ type: 'thinking', thinking: `Original round ${id}` }], stopReason: 'stop' });
  const rounds = [round('before'), { ...round('question'), content: [...round('question').content, call('human', 'ask_user_question', textArgs)] }, round('after')];
  const savedBranch = branch;
  branch = rounds.map(message => ({ type: 'message', message }));
  const roundHistory = JSON.stringify(branch);
  await emit('session_tree', {});
  const thinkingCards = rounds.map(message => new AssistantMessageComponent(message, true, getMarkdownTheme()));
  for (const card of thinkingCards) assert.ok(card.render(100).length > 0, 'human question separates hidden thinking groups');
  assert.equal(JSON.stringify(branch), roundHistory);
  branch = savedBranch;
  for (const event of ['session_tree', 'session_switch', 'session_compact']) { await emit(event, {}); assert.equal(JSON.stringify(branch), history); }
  await emit('session_shutdown', {});
  q1.invalidate(); assert.match(q1.render(120).join('\n'), /Your answer/);
  assert.ok(redraws < 1000, 'no recursive repaint loop');
}
// Exact invocation-order grouping in one assistant batch, live start and rebuild.
const batch = { role: 'assistant', content: ['before', 'q1', 'between', 'q2', 'after'].map(id => ({ type: 'toolCall', id, name: id.startsWith('q') ? 'ask_user_question' : 'read', arguments: {} })) };
const groups = new QuietGroups(); groups.assistant(batch);
assert.equal(new Set([...groups.nodes.values()].map(n => n.group)).size, 5);
for (const node of groups.nodes.values()) groups.start(node.id, node.name);
assert.equal(new Set([...groups.nodes.values()].map(n => n.group)).size, 5);
groups.rebuild([{ type: 'message', message: batch }]);
assert.equal(new Set([...groups.nodes.values()].map(n => n.group)).size, 5);
assert.equal(groups.summary('q1'), undefined, 'human calls are not ordinary pane owners');
// Event-only starts still establish the same before/after presentation boundary.
const startsOnly = new QuietGroups();
for (const call of batch.content) startsOnly.start(call.id, call.name);
assert.equal(new Set([...startsOnly.nodes.values()].map(n => n.group)).size, 5);
const ordinary = new QuietGroups(); ordinary.assistant({ ...batch, content: batch.content.map(c => ({ ...c, name: 'ask_question' })) });
assert.equal(new Set([...ordinary.nodes.values()].map(n => n.group)).size, 1);
// Unknown, mismatched, malformed and nested-only metadata never validate.
for (const details of [undefined, { ...selected.details, question: 'different call' }, { ...selected.details, answers: [{ ...selected.details.answers[0], index: 99 }] }, { ...selected.details, answers: [{ type: 'text', label: 'invented', value: 'invented' }] }, { calls: [{ name: 'ask_user_question', result: selected }] }]) assert.equal(answeredDetails(details, optionArgs), false);
const theme = { fg: (_, s) => s, bold: s => s };
const stock = { renderResult: () => ({ render: () => ['STOCK FALLBACK'], invalidate() {} }) };
assert.deepEqual(humanAnswerRenderer(stock).renderResult(text, { isPartial: false, expanded: false }, theme, { args: optionArgs }).render(80), ['STOCK FALLBACK']);
// Actual isolated SDK reload with retained native human cards. Rendering owns no
// ctx, prototype, timer, registry or synthetic message and survives revocation.
const sdk = await import(pathToFileURL(`${root}/dist/index.js`));
const { loadExtensionFromFactory } = await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const eventBus = sdk.createEventBus();
let loaded, contexts = [], sdkResolver, modelCalls = 0, inputCalls = 0;
const load = async () => {
  const runtime = sdk.createExtensionRuntime();
  const e = await loadExtensionFromFactory(pi => {
    pi.registerToolRenderer((name, next) => name === 'ask_user_question' ? humanAnswerRenderer(next()) : next());
    pi.on('session_start', (_e, ctx) => contexts.push(ctx));
    pi.on('input', () => { inputCalls++; throw Error('FORBIDDEN_INPUT'); });
    sdkResolver = (name, next) => name === 'ask_user_question' ? humanAnswerRenderer(next()) : next();
  }, dir, eventBus, runtime, new URL('./index.ts', import.meta.url).pathname);
  loaded = { extensions: [e], errors: [], runtime };
};
await load();
const resources = { getExtensions: () => loaded, getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => [], getSystemPrompt: () => '', getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, reload: load };
const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json') });
let session;
try {
  for (const key of ['stream', 'streamSimple']) modelRuntime[key] = () => { modelCalls++; throw Error('FORBIDDEN_MODEL'); };
  const manager = sdk.SessionManager.inMemory(dir);
  manager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'sdk-q', name: 'ask_user_question', arguments: optionArgs }] });
  manager.appendMessage({ role: 'toolResult', toolCallId: 'sdk-q', toolName: 'ask_user_question', ...selected, isError: false });
  ({ session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, sessionManager: manager, settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { mode: 'off' } }), resourceLoader: resources, modelRuntime, noTools: true }));
  session.agent.prompt = async () => { modelCalls++; throw Error('FORBIDDEN_AGENT_PROMPT'); };
  await session.bindExtensions({ mode: 'tui', uiContext: { theme: liveTheme }, onError: e => { throw e; } });
  const stored = JSON.stringify(manager.getBranch()), modelHistory = JSON.stringify(session.messages);
  const retained = new ToolExecutionComponent('ask_user_question', 'sdk-q', optionArgs, { showImages: false }, { name: 'ask_user_question', ...sdkResolver('ask_user_question', () => question) }, { requestRender() {} }, dir);
  retained.updateResult(selected, false);
  for (let cycle = 0; cycle < 3; cycle++) {
    const oldContext = contexts.at(-1);
    await session.reload();
    assert.throws(() => oldContext.ui, /stale/);
    for (const palette of ['dark', 'light']) { initTheme(palette, false); retained.invalidate(); assert.match(retained.render(100).join('\n'), /Your answer · Selected option/); }
    retained.setExpanded(true); assert.match(retained.render(100).join('\n'), /machine_value/); retained.setExpanded(false);
    assert.equal(JSON.stringify(manager.getBranch()), stored);
    assert.equal(JSON.stringify(session.messages), modelHistory);
  }
  assert.equal(modelCalls, 0); assert.equal(inputCalls, 0);
} finally { session?.dispose(); await modelRuntime.dispose?.(); }
console.log('human answer presentation: installed formatter/native cards, modes, themes, widths, expansion/mouse, exact IDs, boundaries, 3 actual isolated SDK reloads, zero model/input calls and immutable history passed');
} finally { if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir; rmSync(dir, { recursive: true, force: true }); }
