import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root = process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const { createJiti } = createRequire(`${root}/package.json`)('jiti');
const tuiPath = `${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': tuiPath, '@earendil-works/pi-coding-agent': `${root}/dist/index.js` } });
const extension = await jiti.import(new URL('./index.ts', import.meta.url).pathname, { default: true });
const sdk = await import(pathToFileURL(`${root}/dist/index.js`));
const { ToolExecutionComponent } = await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const { visibleWidth, Text } = await import(pathToFileURL(tuiPath));
const { initTheme, theme, getMarkdownTheme } = await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const content = card => card.render(100).map(strip).filter(row => row.trim());
const firstColumn = row => row.search(/\S/);
const dir = mkdtempSync(join(tmpdir(), 'pi-quiet-notice-alignment-'));
const oldDir = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
try {
for (const mode of ['quiet', 'compact', 'expanded']) {
  writeFileSync(join(dir, 'compact-tool-renderers.json'), JSON.stringify({ mode }));
  let resolve; const hooks = new Map(); let redraws = 0;
  extension({ registerToolRenderer(fn) { resolve = fn; }, on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); }, registerMarkdownTransformer() {}, registerCommand() {}, getCommands: () => [] });
  const ctx = { mode: 'tui', sessionManager: { getBranch: () => [] }, ui: { theme, setHiddenThinkingLabel() {}, setToolsExpanded() {} } };
  const emit = async (name, event) => { for (const fn of hooks.get(name) || []) await fn(event, ctx); };
  initTheme('dark', false); await emit('session_start', {});
  for (const outputPad of [0, 1, 2, 4]) {
    const args = { name: 'om-migration-audit', message: 'Original child delivery text' };
    const started = { content: [{ type: 'text', text: 'Original started result' }], details: { status: 'started', delivery: { exact: 'preserve me' } } };
    const cancelled = { content: [{ type: 'text', text: 'Original cancellation reason' }], details: { status: 'cancelled' } };
    const failed = { content: [{ type: 'text', text: 'Original failure reason' }], isError: true };
    const original = JSON.stringify({ args, started, cancelled, failed });
    const id = `notice-${mode}-${outputPad}`;
    const card = new ToolExecutionComponent('subagent_message', id, args, { showImages: false, outputPad }, { name: 'subagent_message', ...resolve('subagent_message', () => undefined) }, { requestRender() { redraws++; } }, dir);
    await emit('tool_execution_start', { toolCallId: id, toolName: 'subagent_message' });
    card.markExecutionStarted();
    assert.match(content(card).join('\n'), mode === 'quiet' ? /running subagent_message/ : /subagent_message/);
    card.updateResult(started, false);
    for (const palette of ['dark', 'light']) {
      initTheme(palette, false); card.invalidate();
      const rows = content(card);
      assert.match(rows.join('\n'), mode === 'quiet' ? /▸ Message · om-migration-audit · Started/ : /Started/);
      assert.equal(firstColumn(rows[0]), mode === 'quiet' ? 0 : outputPad, `${mode}, pad ${outputPad}: standalone notice column`);
      if (mode === 'quiet') {
        assert.equal(card.render(100).length, 2, 'retain native separator plus one notice row');
        assert.match(rows[0], /^▸ Message/, 'actual result-bearing native expansion target');
        // Existing actual native tool/thinking/completion cards share that column.
        const tool = new ToolExecutionComponent('read', `reference-${id}`, { path: '/tmp/example' }, { showImages: false, outputPad }, { name: 'read', ...resolve('read', () => undefined) }, { requestRender() {} }, dir);
        tool.updateResult({ content: [{ type: 'text', text: 'reference output' }] }, false);
        const thinking = new sdk.AssistantMessageComponent({ role: 'assistant', content: [{ type: 'thinking', thinking: '## Reference thinking' }], stopReason: 'stop' }, true, getMarkdownTheme());
        const report = new sdk.CustomMessageComponent({ role: 'custom', customType: 'subagent_result', display: true, content: 'Original completion', details: { name: 'reference', exitCode: 0 } }, () => new Text('Native completion', 0, 0), getMarkdownTheme(), outputPad);
        for (const reference of [tool, thinking, report]) assert.equal(firstColumn(content(reference)[0]), firstColumn(rows[0]));
      }
      for (const width of [1, 2, 3, 4, 8, 28, 50, 100]) for (const row of card.render(width)) assert.ok(visibleWidth(row) <= width, `${mode}/${outputPad}/${width}`);
    }
    card.setExpanded(true);
    const expanded = content(card).join('\n');
    assert.match(expanded, /om-migration-audit/);
    if (mode !== 'quiet') assert.equal(firstColumn(content(card)[0]), outputPad, 'non-Quiet expanded padding unchanged');
    assert.ok(card.render(100).length > 2);
    card.setExpanded(false);
    assert.equal(card.handleMouse({ type: 'click', button: 'left', x: 0, y: 1, width: 100, height: 30 })?.handled, true, 'native result-bearing card click expansion');
    assert.ok(card.render(100).length > 2); card.setExpanded(false);
    // Started -> cancelled -> failed -> settled -> started keeps honest states.
    card.updateResult(cancelled, false);
    assert.match(content(card).join('\n'), /[Cc]ancelled/);
    assert.equal(firstColumn(content(card)[0]), mode === 'quiet' ? 0 : outputPad);
    card.updateResult(failed, false);
    assert.match(content(card).join('\n'), /(?:Failed ✗|Failed).*Original failure reason/);
    assert.ok(!content(card).join('\n').includes('Your answer'));
    assert.equal(firstColumn(content(card)[0]), mode === 'quiet' ? 0 : outputPad, 'Quiet failure strip aligns; non-Quiet error padding unchanged');
    // Screenshot regression: a refused scout call can reach the native card
    // without a tool_execution_start event. Its Quiet error uses the same root
    // disclosure/text gutter, not the old padded two-line generic error shell.
    const blockedArgs = { agent: 'scout', task: 'Read-only context inspection' };
    const budgetError = 'Shared child budget full: at most two delegated/memory children and one writer. Wait for actual exit.';
    const blockedResult = { content: [{ type: 'text', text: budgetError }], isError: true };
    const blockedSource = JSON.stringify({ blockedArgs, blockedResult });
    const blocked = new ToolExecutionComponent('subagent', `blocked-${id}`, blockedArgs, { showImages: false, outputPad }, { name: 'subagent', ...resolve('subagent', () => undefined) }, { requestRender() {} }, dir);
    blocked.updateResult(blockedResult, false);
    for (const palette of ['dark', 'light']) {
      initTheme(palette, false); blocked.invalidate();
      const rows = blocked.render(200).map(strip).filter(row => row.trim());
      assert.equal(firstColumn(rows[0]), mode === 'quiet' ? 0 : outputPad, 'refused subagent keeps the appropriate root/padded gutter');
      if (mode === 'quiet') {
        assert.deepEqual(rows, [`▸ Failed ✗ · Start scout · ${budgetError}`]);
        assert.equal(rows[0].indexOf('Failed'), 2, 'refused subagent label matches Thinking/Tools text column');
        assert.equal(blocked.render(200).length, 2, 'one native separator plus exactly one failure row');
      }
      for (const width of [1, 2, 3, 4, 8, 28, 50, 100]) for (const row of blocked.render(width)) assert.ok(visibleWidth(row) <= width, `blocked ${mode}/${outputPad}/${width}`);
    }
    blocked.setExpanded(true);
    const blockedDetails = blocked.render(200).map(strip).join('\n');
    assert.ok(blockedDetails.includes(budgetError), 'expansion retains the complete recorded budget refusal');
    blocked.setExpanded(false);
    assert.equal(blocked.handleMouse({ type: 'click', button: 'left', x: mode === 'quiet' ? 0 : outputPad, y: 1, width: 200, height: 30 })?.handled, true, 'aligned failure disclosure still expands natively');
    assert.ok(blocked.render(200).map(strip).join('\n').includes(budgetError));
    assert.equal(JSON.stringify({ blockedArgs, blockedResult }), blockedSource, 'presentation does not change budget enforcement/input/result');
    card.updateResult({ content: [{ type: 'text', text: 'Original settled result' }] }, false);
    assert.match(content(card).join('\n'), mode === 'quiet' ? /Tools/ : /Completed/);
    card.updateResult(started, false);
    assert.equal(firstColumn(content(card)[0]), mode === 'quiet' ? 0 : outputPad);
    // Missing stable native call ID truthfully uses the unchanged per-call fallback.
    const fallback = resolve('subagent_message', () => undefined).renderCall(args, theme, { args, state: {}, outputPad, expanded: false, invalidate() {} });
    assert.equal(firstColumn(strip(fallback.render(100)[0])), outputPad);
    assert.equal(JSON.stringify({ args, started, cancelled, failed }), original);
  }
  assert.ok(redraws < 300, 'no recursive repaints');
  await emit('session_shutdown', {});
}
console.log('PASS: actual native standalone Quiet notices and screenshot-equivalent blocked subagent align with tool/thinking/completion gutters across pad0/1/2/4, dark/light, narrow widths; one-row refusal, full native click/expansion, status transitions, failure and non-Quiet/fallback padding, immutable source and bounded redraws preserved.');
} finally { oldDir === undefined ? delete process.env.PI_CODING_AGENT_DIR : process.env.PI_CODING_AGENT_DIR = oldDir; rmSync(dir, { recursive: true, force: true }); }
