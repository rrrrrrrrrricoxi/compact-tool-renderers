#!/usr/bin/env node
// Actual Pi TUI with invented records and an isolated temporary home. No credentials or live services.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(process.env.PI_RUNTIME || path.join(os.homedir(), '.local/state/pi-config/current/runtime'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-renderer-preview-'));
const agentDir = path.join(temporary, '.pi/agent'), cwd = path.join(temporary, 'fixture');
await fs.mkdir(agentDir, { recursive: true }); await fs.mkdir(cwd);
process.env.HOME = temporary; process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = '1';
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$/.test(key)) delete process.env[key];
globalThis.fetch = async () => { throw new Error('Network disabled in renderer preview'); };
const core = await import(pathToFileURL(path.join(runtimePath, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
const template = 'This is an invented long prompt template used only to inspect display behavior. Review the recorded examples, expand the tool groups, and compare native display. No commands should run and no services should be contacted.';
await fs.mkdir(path.join(agentDir, 'prompts'));
await fs.writeFile(path.join(agentDir, 'prompts/fixture.md'), template);
await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
  packages: [source], extensions: [path.join(source, 'preview-fixture.ts')],
  hideThinkingBlock: true, theme: 'dark', compaction: { enabled: false },
  terminal: { showImages: false },
}));
const manager = core.SessionManager.inMemory(cwd);
const now = Date.now(); let sequence = 0;
const append = message => manager.appendMessage({ ...message, timestamp: now + sequence++ });
const assistant = (content, stopReason = 'stop') => append({ role: 'assistant', content, api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6-luna', stopReason,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const call = (id, name, args, output, details = {}, isError = false, thinking = '') => {
  assistant([...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'toolCall', id, name, arguments: args }], 'toolUse');
  append({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: output }], details, isError });
};
append({ role: 'user', content: template });
call('read-1', 'read', { path: '/fixture/example.txt' }, 'Recorded first line\nRecorded second line', {}, false, 'Invented recorded thinking: inspect the sample file. This is fixture text, not model reasoning.');
call('shell-1', 'bash', { command: 'printf sample' }, Array.from({ length: 250 }, (_, i) => `Example row ${i + 1} · 中文 · coating units kg/L`).join('\n'), {}, false,
  'Invented recorded second round. The sample output is long enough to test bounded scrolling.');
call('edit-1', 'edit', { path: '/fixture/example.txt', oldText: 'before', newText: 'after' }, 'Recorded edit completed.', { warning: 'Example warning retained in the group label.' });
assistant([{ type: 'text', text: 'Visible reply: the three completed actions above form one group. This reply separates the next group.' }]);
call('question-1', 'ask_user_question', { question: 'Which sample should be shown?', options: ['One', 'Two'] }, 'One', { status: 'answered', question: 'Which sample should be shown?', answers: [{ label: 'One', value: 'one' }] });
call('failed-1', 'bash', { command: 'fixture-failure' }, 'Invented failure: sample file not found. No command ran.', { exitCode: 1 }, true);
call('question-2', 'ask_user_question', { question: 'Cancelled example' }, 'No answer recorded.', { status: 'cancelled', question: 'Cancelled example' });
call('read-2', 'read', { path: '/fixture/last.txt' }, 'Recorded final output.');
assistant([{ type: 'text', text: 'Preview controls: Alt+G focuses tools; Left/Right selects an action; Enter expands its output; Up/Down scroll; Esc releases focus. Alt+T focuses recorded thinking; Alt+I focuses the prompt. /fixture-permission opens a harmless approval dialog. /compact-rendering switches display. Ctrl+D exits.' }]);
manager.appendSessionInfo('compact-renderer-preview');
let runtime, ui;
try {
  const factory = async ({ sessionManager, sessionStartEvent }) => {
    const modelRuntime = await core.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const services = await core.createAgentSessionServices({ cwd, agentDir, modelRuntime });
    const result = await core.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: modelRuntime.getModel('openai-codex', 'gpt-6-luna') });
    result.session.agent.streamFn = () => { throw new Error('Model calls disabled in renderer preview'); };
    return { ...result, services, diagnostics: services.diagnostics };
  };
  runtime = await core.createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: manager });
  if (runtime.diagnostics.some(item => item.type === 'error')) throw new Error(JSON.stringify(runtime.diagnostics));
  ui = new core.InteractiveMode(runtime, { tuiMode: 'fullscreen' });
  await ui.run();
} finally {
  ui?.stop(); await runtime?.dispose(); await fs.rm(temporary, { recursive: true, force: true });
}
