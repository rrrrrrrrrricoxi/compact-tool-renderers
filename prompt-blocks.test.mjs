import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const { createJiti } = createRequire(`${root}/package.json`)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-coding-agent': `${root}/dist/index.js` } });
const mod = await jiti.import(new URL('./prompt-blocks.ts', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'pi-prompt-blocks-'));
const oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
try {
  const templatePath = join(dir, 'sample.md');
  const body = 'Read the project workflow at `.pi/workflows/connect.md` and follow it carefully.\nKeep administrator and collaborator paths separate.\n\nUser arguments: $ARGUMENTS';
  writeFileSync(templatePath, '---\ndescription: Connect workflow\n---\n' + body + '\n');
  const commands = [{ name: 'example:connect', source: 'prompt', sourceInfo: { path: templatePath } }];
  const templates = mod.templateMatchers(commands);
  assert.equal(templates.length, 1);
  const message = body.replace('$ARGUMENTS', 'read-only');
  assert.equal(mod.matchingTemplate(message, templates), 'example:connect');
  assert.equal(mod.matchingTemplate(body.replace('$ARGUMENTS', ''), templates), 'example:connect');
  assert.equal(mod.matchingTemplate('Ordinary user message', templates), undefined);
  assert.equal(mod.templateMatchers([...commands, {name:'example:connect',source:'extension'}]).length, 0);
  assert.equal(mod.templateMatchers([{...commands[0],source:'skill'}]).length, 0);
  const fileBefore = readFileSync(templatePath, 'utf8');
  const handlers = {};
  let transform, control, display;
  const register = () => display = mod.default({
    getCommands: () => commands,
    on: (name, handler) => { handlers[name] = handler; },
    registerMarkdownTransformer: fn => { transform = fn; },
    registerCommand: (name, definition) => { assert.equal(name, 'blocks'); control = definition; },
  });
  const notifications = [];
  let expanded, reloads = 0, idle = true;
  const ctx = { mode: 'tui', isIdle: () => idle, ui: { setToolsExpanded: v => {expanded=v;}, getToolsExpanded: () => expanded, notify: (...v) => notifications.push(v) }, reload: async () => {reloads++;} };
  register(); handlers.session_start({}, ctx);
  assert.equal(display.getMode(), 'quiet');
  assert.equal(expanded, false);
  const compact = transform(message, {messageType:'user'});
  assert.match(compact, /\*\*prompt\*\* · \/example:connect/);
  assert.equal(compact.split('\n').length, 1);
  assert.equal(transform(message, {messageType:'assistant'}), message);
  assert.equal(transform(message, {messageType:'assistant-thinking'}), message);
  assert.equal(transform('Ordinary user message', {messageType:'user'}), 'Ordinary user message');
  // Real UserMessageComponent applies the transform, and retains the original source text.
  const { initTheme, getMarkdownTheme } = await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
  const { UserMessageComponent } = await import(pathToFileURL(`${root}/dist/modes/interactive/components/user-message.js`));
  initTheme('dark', false);
  const user = new UserMessageComponent(message, getMarkdownTheme(), 1, [transform]);
  assert.equal(user.text, message);
  assert.ok(user.render(120).length < new UserMessageComponent(message, getMarkdownTheme(), 1).render(120).length);
  await control.handler('expanded', ctx);
  assert.equal(expanded, true); assert.equal(reloads, 1);
  assert.equal(JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json'),'utf8')).mode, 'expanded');
  register(); handlers.session_start({}, ctx); // actual reload constructs a new extension runtime
  assert.equal(transform(message, {messageType:'user'}), message);
  assert.equal(expanded, true);
  idle = false; await control.handler('compact', ctx);
  assert.equal(reloads, 1); assert.equal(expanded, true);
  idle = true;
  const childKey = Symbol.for('pi-subagents/running-children-count');
  globalThis[childKey] = () => 1;
  try { await control.handler('compact', ctx); assert.equal(reloads, 1); }
  finally { delete globalThis[childKey]; }
  await control.handler('compact', ctx); assert.equal(reloads, 2); assert.equal(expanded, false);
  register(); handlers.session_start({}, ctx);
  assert.match(transform(message, {messageType:'user'}), /prompt/);
  await control.handler('status', ctx); assert.match(notifications.at(-1)[0], /compact/);
  await control.handler('quiet', ctx); assert.equal(reloads, 3); assert.equal(expanded, false);
  register(); handlers.session_start({}, ctx);
  assert.equal(display.getMode(), 'quiet');
  assert.match(transform(message, {messageType:'user'}), /prompt/);
  assert.equal(JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json'),'utf8')).mode, 'quiet');
  assert.equal(readFileSync(templatePath,'utf8'), fileBefore);
  assert.equal(message, body.replace('$ARGUMENTS','read-only'));
  console.log('PASS: template recognition, original user source retained, display-only compaction, ordinary/assistant messages unchanged, shared mode persistence/reload, idle/child guards, original files untouched');
} finally {
  oldAgent === undefined ? delete process.env.PI_CODING_AGENT_DIR : process.env.PI_CODING_AGENT_DIR = oldAgent;
  rmSync(dir, {recursive:true,force:true});
}
