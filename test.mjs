import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const require = createRequire(`${root}/package.json`);
const { createJiti } = require('jiti');
const tuiPath = `${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const { visibleWidth } = await import(pathToFileURL(tuiPath));
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': tuiPath, '@earendil-works/pi-coding-agent': `${root}/dist/index.js` } });
const extension = await jiti.import(new URL('./index.ts', import.meta.url).pathname, { default: true });
let resolver;
const hooks = [];
extension({ registerToolRenderer(fn) { resolver = fn; }, on(event) { hooks.push(event); }, registerMarkdownTransformer() {}, registerCommand() {} });
assert.deepEqual(hooks, ['session_start', 'session_switch', 'session_tree', 'session_compact', 'session_shutdown', 'message_end', 'tool_execution_start', 'tool_execution_end', 'session_start', 'session_switch', 'session_shutdown', 'session_start', 'session_switch', 'session_tree', 'session_compact', 'message_start', 'message_update', 'message_end', 'session_shutdown', 'session_start', 'session_switch', 'session_tree', 'session_compact', 'session_shutdown']);
const theme = { fg: (_, s) => s, bg: (_, s) => s, bold: s => s };
const stockCall = { render() { return ['full script']; } };
const stockResult = { render() { return ['full result']; } };
const stock = { renderCall: () => stockCall, renderResult: () => stockResult };
assert.notEqual(resolver('read', () => stock), stock);
const renderer = resolver('codemode', () => stock);
assert.equal(renderer.renderShell, 'self');
const context = { expanded: false, isError: false };
const args = { code: 'text("secret script");\n'.repeat(50) };
assert.equal(renderer.renderCall(args, theme, context).render(80).length, 1);
assert.ok(!renderer.renderCall(args, theme, context).render(80)[0].includes('secret'));
const result = { content: [{ type: 'text', text: 'Script completed\nWall time 0.8 seconds\nOutput:\n' }, { type: 'text', text: 'LONG OUTPUT\n'.repeat(100) }], details: { calls: [{ name: 'mcp__ascend__mssql_run_sql_query', status: 'ok' }] } };
const collapsed = renderer.renderResult(result, { expanded: false, isPartial: false }, theme, context);
assert.match(collapsed.render(150)[0], /✓ 1 call · mssql_run_sql_query · 0.8s/);
assert.ok(!collapsed.render(150)[0].includes('LONG OUTPUT'));
for (const width of [1, 8, 20, 80, 150]) {
  assert.equal(collapsed.render(width).length, 1);
  assert.ok(visibleWidth(collapsed.render(width)[0]) <= width);
}
assert.match(renderer.renderCall(args, theme, { ...context, expanded: true }).render(80)[0], /full script/);
assert.match(renderer.renderResult(result, { expanded: true, isPartial: false }, theme, context).render(80)[0], /full result/);
assert.match(renderer.renderResult(result, { expanded: false, isPartial: true }, theme, context).render(150)[0], /^…/);
const failed = { ...result, details: { calls: [{ name: 'query', status: 'error', error: 'Connection refused\nsecond line' }] } };
assert.match(renderer.renderResult(failed, { expanded: false, isPartial: false }, theme, context).render(200)[0], /✗.*1 failed.*Connection refused/);
const scriptFailure = { content: [{ type: 'text', text: 'Script failed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'text', text: 'Script error:\nSyntaxError: unexpected token' }] };
assert.match(renderer.renderResult(scriptFailure, { expanded: false, isPartial: false }, theme, context).render(200)[0], /✗.*SyntaxError/);
assert.match(renderer.renderResult({ ...result, details: { calls: [] } }, { expanded: false, isPartial: false }, theme, context).render(200)[0], /0 calls/);
// Test the actual stock renderers, including expanding AFTER a compact component exists.
const { initTheme } = await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
initTheme('dark', false);
const { bashRenderers, createShellRenderers } = await import(pathToFileURL(`${root}/dist/core/tools/renderers/bash.js`));
const { writeRenderers } = await import(pathToFileURL(`${root}/dist/core/tools/renderers/write.js`));
const { editRenderers } = await import(pathToFileURL(`${root}/dist/core/tools/renderers/edit.js`));
const { codemodeRenderers } = await import(pathToFileURL(`${root}/dist/extensions/codemode/renderer.js`));
for (const [name, original, input, final] of [
  ['bash', bashRenderers || createShellRenderers('$'), { command: 'python3 - <<\'PY\'\nprint("hidden body")\nPY' }, { content: [{ type: 'text', text: 'hidden output' }], details: {} }],
  ['write', writeRenderers, { path: '/tmp/example.txt', content: 'hidden body\nsecond line\n' }, { content: [{ type: 'text', text: 'Successfully wrote file' }] }],
  ['codemode', codemodeRenderers, args, result],
  ['edit', editRenderers, { path: '/tmp/example.txt', edits: [{ oldText: 'hidden old', newText: 'hidden new' }, { oldText: 'a', newText: 'b' }] }, { content: [{ type: 'text', text: 'Successfully replaced 2 blocks' }], details: { diff: ' 1 unchanged\n-2 hidden old\n+2 hidden new\n+3 added line\n-4 removed line' } }],
]) {
  const wrapped = resolver(name, () => original);
  const ctx = { ...context, args: input, state: {}, cwd: '/tmp', outputPad: 0, executionStarted: true, argsComplete: true, showImages: false, durationMs: 500, invalidate() {} };
  const compactCall = wrapped.renderCall(input, theme, ctx);
  const compactResult = wrapped.renderResult(final, { expanded: false, isPartial: false }, theme, ctx);
  for (const width of [1, 20, 80]) {
    assert.equal(compactCall.render(width).length, 1);
    assert.equal(compactResult.render(width).length, 1);
    assert.ok(visibleWidth(compactCall.render(width)[0]) <= width);
    assert.ok(visibleWidth(compactResult.render(width)[0]) <= width);
  }
  assert.ok(!compactCall.render(200).join('').includes('hidden body'));
  const fullCall = wrapped.renderCall(input, theme, { ...ctx, expanded: true, lastComponent: compactCall });
  const fullResult = wrapped.renderResult(final, { expanded: true, isPartial: false }, theme, { ...ctx, lastComponent: compactResult });
  assert.ok(fullCall.render(100).length >= 1);
  assert.ok(Array.isArray(fullResult.render(100)));
  if (name === 'write') assert.match(compactResult.render(200)[0], /Written · 2 lines/);
  if (name === 'edit') {
    assert.match(compactResult.render(200)[0], /Edited · 2 replacements · \+2 \/ −2 lines/);
    assert.ok(!compactCall.render(200)[0].includes('hidden old'));
    assert.ok(!compactResult.render(200)[0].includes('hidden new'));
    assert.ok(fullResult.render(200).join('\n').includes('hidden new'));
    assert.equal(ctx.state.callComponent, undefined);
    // Collapse again after expansion: there must be no retained live-preview diff.
    assert.equal(wrapped.renderCall(input, theme, ctx).render(80).length, 1);
    const single = wrapped.renderCall({ path: '/tmp/example.txt', oldText: 'a', newText: 'b' }, theme, ctx);
    assert.equal(single.render(80).length, 1);
    assert.match(wrapped.renderResult(final, { expanded: false, isPartial: false }, theme, ctx).render(200)[0], /1 replacement ·/);
  }
  if (name === 'bash') {
    assert.match(compactCall.render(200)[0], /bash · Run a Python script/);
    assert.ok(!compactCall.render(200)[0].includes('python3'));
    assert.match(compactResult.render(200)[0], /Completed · 0.5s · output hidden/);
    const errorResult = { content: [{ type: 'text', text: 'permission denied\nProcess exited with code 1' }] };
    assert.match(wrapped.renderResult(errorResult, { expanded: false, isPartial: false }, theme, ctx).render(200)[0], /✗ Failed.*exit 1.*permission denied/);
    const partial = wrapped.renderResult(final, { expanded: false, isPartial: true }, theme, ctx);
    assert.match(partial.render(200)[0], /… Running/);
    wrapped.renderResult(final, { expanded: true, isPartial: true }, theme, { ...ctx, lastComponent: partial });
    assert.ok(ctx.state.interval);
    wrapped.renderResult(final, { expanded: false, isPartial: true }, theme, ctx);
    assert.equal(ctx.state.interval, undefined);
  }
  assert.match(wrapped.renderResult(final, { expanded: false, isPartial: false }, theme, { ...ctx, isError: true }).render(200)[0], /✗/);
}
const shell = resolver('bash', () => stock);
assert.match(shell.renderCall({ command: '# intent: Verify model metadata\npython3 - <<\'PY\'\nprint(1)\nPY' }, theme, { ...context, state: {} }).render(200)[0], /Verify model metadata/);
assert.match(shell.renderCall({ command: "rg -n 'contextWindow' private-file" }, theme, { ...context, state: {} }).render(200)[0], /Search model and context-limit definitions/);
assert.match(renderer.renderCall({ code: '// @options: {"timeout_ms": 5000}\n// intent: Read installed model definitions\ntext(1);' }, theme, context).render(200)[0], /Read installed model definitions/);
const legacyCommand = '# intent: Verify model metadata\npython3 - <<\'PY\'\nprint(1)\nPY';
const fullShellCall = shell.renderCall({ command: legacyCommand }, theme, { ...context, expanded: true, state: {} }).render(200).join('\n');
assert.match(fullShellCall, /^bash/);
assert.ok(!fullShellCall.includes('# intent:'));
assert.ok(!fullShellCall.includes('$'));
assert.ok(fullShellCall.includes('python3'));
assert.ok(legacyCommand.startsWith('# intent:')); // original execution input untouched
const backgrounds = [];
const coloredTheme = { ...theme, bg: (name, s) => { backgrounds.push(name); return s; } };
for (const [isError, isPartial, expected] of [[false, false, 'toolSuccessBg'], [true, false, 'toolErrorBg'], [false, true, 'toolPendingBg']]) {
  shell.renderResult({ content: [] }, { expanded: false, isPartial }, coloredTheme, { ...context, state: {}, isError, isPartial }).render(80);
  assert.equal(backgrounds.at(-1), expected);
}
// Every tool name, including future/unknown tools, must get bounded collapsed rows.
const { createAllToolRenderers } = await import(pathToFileURL(`${root}/dist/core/tools/renderers/index.js`));
const builtins = createAllToolRenderers();
for (const name of ['read', 'grep', 'find', 'ls', 'powershell', 'web_search', 'web_fetch', 'research_guard', 'subagent', 'subagent_message', 'subagents_list', 'mcp__example__query', 'future_tool']) {
  const original = builtins[name];
  const compact = resolver(name, () => original);
  const input = { path: '/tmp/example.txt', pattern: 'match', query: 'public query', url: 'https://example.com/page?omit=params', agent: 'scout', command: 'Write-Output example' };
  const ctx = { ...context, args: input, state: {}, cwd: '/tmp', outputPad: 0, executionStarted: true, argsComplete: true, showImages: false, durationMs: 100, invalidate() {} };
  const large = { content: [{ type: 'text', text: 'hidden payload\n'.repeat(500) }], details: name === 'web_search' ? { results: [{ url: 'https://example.com' }, {}] } : undefined };
  const call = compact.renderCall(input, theme, ctx);
  const output = compact.renderResult(large, { expanded: false, isPartial: false }, theme, ctx);
  for (const width of [1, 20, 80]) {
    for (const component of [call, output]) {
      assert.equal(component.render(width).length, 1, name);
      assert.ok(visibleWidth(component.render(width)[0]) <= width, name);
    }
  }
  assert.ok(!output.render(200)[0].includes('hidden payload'), name);
  if (name === 'web_search') assert.match(output.render(200)[0], /2 results/);
  const fullCall = compact.renderCall(input, theme, { ...ctx, expanded: true, lastComponent: call });
  const fullOutput = compact.renderResult(large, { expanded: true, isPartial: false }, theme, { ...ctx, lastComponent: output });
  assert.ok(fullCall.render(100).length >= 1, name);
  assert.ok(fullOutput.render(100).join('\n').includes('hidden payload'), name);
  assert.match(compact.renderResult({ content: [{ type: 'text', text: 'HTTP 403' }] }, { expanded: false, isPartial: false }, theme, { ...ctx, isError: true }).render(200)[0], /✗ Failed.*HTTP 403/);
  assert.match(compact.renderResult(large, { expanded: false, isPartial: true }, theme, ctx).render(200)[0], /… Running/);
}
const web = resolver('web_search', () => undefined);
assert.match(web.renderResult({ content: [{ type: 'text', text: '{"results":[]}' }] }, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(200)[0], /0 results/);
assert.match(web.renderResult({ content: [{ type: 'text', text: 'not valid JSON' }] }, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(200)[0], /Completed/);
const unknown = resolver('future_tool', () => undefined);
assert.match(unknown.renderResult({ content: [], details: { status: 'started' } }, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(200)[0], /✓ Started/);
assert.match(unknown.renderResult({ content: [], details: { status: 'cancelled' } }, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(200)[0], /⊘ Cancelled/);
assert.match(unknown.renderResult({ content: [], details: { isError: true, error: 'denied' } }, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(200)[0], /✗ Failed.*denied/);
const imageResult = { content: [{ type: 'image', mimeType: 'image/png', data: 'fakebase64' }] };
assert.match(unknown.renderResult(imageResult, { expanded: false, isPartial: false }, theme, context).render(200)[0], /1 image/);
assert.ok(!unknown.renderResult(imageResult, { expanded: true, isPartial: false }, theme, context).render(200).join('').includes('fakebase64'));
console.log('PASS: all built-in categories, web/guard/subagent/MCP/unknown tools, bounded previews, errors/partial/cancelled/started states, stock/full expansion, images metadata, colors, clock cleanup');
