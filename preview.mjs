#!/usr/bin/env node
// Actual Pi TUI with invented records and an isolated temporary home. No credentials or live services.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
export async function createPreview() {
  const hostHome = os.homedir();
  const runtimePath = path.resolve(process.env.PI_RUNTIME || path.join(hostHome, '.local/state/pi-config/current/runtime'));
  const promptJump = process.env.PI_PROMPT_JUMP_PATH ? path.resolve(process.env.PI_PROMPT_JUMP_PATH) : undefined;
  const questionCandidates = process.env.PI_QUESTIONS_PATH ? [path.resolve(process.env.PI_QUESTIONS_PATH)] : [
    path.join(hostHome, '.local/state/pi-config/current/packages/pi-questions/index.ts'),
    path.join(runtimePath, 'node_modules/pi-questions/index.ts'),
    path.join(hostHome, 'Code/pi-config/packages/pi-questions/index.ts'),
  ];
  let questionsPath;
  for (const candidate of questionCandidates) {
    if (await fs.stat(candidate).then(stat => stat.isFile(), () => false)) { questionsPath = candidate; break; }
  }
  if (process.env.PI_QUESTIONS_PATH && !questionsPath) throw new Error('PI_QUESTIONS_PATH must point to an existing pi-questions/index.ts.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-renderer-preview-'));
  const agentDir = path.join(temporary, '.pi/agent'), cwd = path.join(temporary, 'fixture');
  const savedEnv = new Map();
  const setEnv = (key, value) => { savedEnv.set(key, process.env[key]); if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  const originalFetch = globalThis.fetch;
  let runtime;
  const cleanup = async () => {
    try { await runtime?.dispose(); }
    finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await fs.rm(temporary, { recursive: true, force: true });
    }
  };
  try {
    await fs.mkdir(agentDir, { recursive: true }); await fs.mkdir(cwd);
    setEnv('HOME', temporary); setEnv('PI_CODING_AGENT_DIR', agentDir); setEnv('PI_OFFLINE', '1');
    for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$/.test(key)) setEnv(key, undefined);
    globalThis.fetch = async () => { throw new Error('Network disabled in renderer preview'); };
    const core = await import(pathToFileURL(path.join(runtimePath, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
    const template = 'This is an invented long prompt template used only to inspect display behavior. Review the recorded examples, expand the tool groups, and compare native display. No commands should run and no services should be contacted.';
    await fs.mkdir(path.join(agentDir, 'prompts'));
    await fs.writeFile(path.join(agentDir, 'prompts/fixture.md'), `---\ndescription: Inspect synthetic tool, question, and skill display examples.\n---\n${template}`);
    const skillDir = path.join(agentDir, 'skills/fixture-review');
    const skillBody = '# Review the synthetic preview\n\nRead the invented sample identifiers and units. Expand the recorded tool outputs and retain missing-value warnings. This skill text is a display fixture; it performs no operation.';
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: fixture-review\ndescription: Review invented sample records for a display exercise.\n---\n${skillBody}\n`);
    await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
      packages: [source, ...(promptJump ? [promptJump] : [])],
      extensions: [path.join(source, 'preview-fixture.ts'), ...(questionsPath ? [questionsPath] : [])],
      hideThinkingBlock: true, theme: 'dark', compaction: { enabled: false }, terminal: { showImages: false },
    }));
    const manager = core.SessionManager.inMemory(cwd);
    const now = Date.now(); let sequence = 0;
    const append = message => manager.appendMessage({ ...message, timestamp: now + sequence++ });
    const assistant = (content, stopReason = 'stop') => append({ role: 'assistant', content, api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6-luna', stopReason,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const call = (id, name, args, output, details = {}, isError = false, thinking = '', durationMs) => {
      assistant([...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'toolCall', id, name, arguments: args }], 'toolUse');
      append({ role: 'toolResult', toolCallId: id, toolName: name, content: Array.isArray(output) ? output : [{ type: 'text', text: output }], details, isError, ...(durationMs === undefined ? {} : { durationMs }) });
    };
    append({ role: 'user', content: template });
    call('write-1', 'write', { path: '/fixture/sample-a.txt', content: 'alpha' }, 'Successfully wrote to /fixture/sample-a.txt', {}, false, '**Inspect the sample fields**\n\n' + Array.from({ length: 70 }, (_, i) => `Synthetic paragraph ${i + 1}: compare the sample identifier, recorded units, and required fields. This is invented preview text, not model reasoning.`).join('\n\n'));
    call('write-2', 'write', { path: '/fixture/sample-b.txt', content: 'beta' }, 'Successfully wrote to /fixture/sample-b.txt', {}, false, '# Compare the recorded output\n\n' + Array.from({ length: 70 }, (_, i) => `Synthetic paragraph ${i + 1}: inspect the fixture output and retain missing-value warnings. This is invented preview text for scrolling tests.`).join('\n\n'));
    call('read-1', 'read', { path: '/fixture/sample-a.txt', offset: null, limit: null }, 'alpha');
    call('read-density-2', 'read', { path: '/fixture/sample-b.txt', offset: null, limit: null }, 'beta');
    call('missing-density', 'read', { path: '/fixture/missing.txt', offset: null, limit: null }, "ENOENT: no such file or directory, access '/fixture/missing.txt'", {}, true);
    assistant([{ type: 'text', text: 'Visible reply: the four actions above form one group. The missing-file error stays separate. Expand an action for content, then its Details for exact arguments and diagnostics. /fixture above is a prompt template; the native [skill] example appears below.' }]);
    append({ role: 'user', content: 'Show the recorded native JavaScript, detailed questions, and failure examples.' });
    const code = [
      '// Synthetic recording only. This script is never executed.',
      'const reads = await Promise.allSettled([',
      '  tools.read({ path: "/fixture/sample-a.json" }),',
      '  tools.read({ path: "/fixture/missing.json" }),',
      ']);',
      'const classifier = { provider: "fixture", id: "synthetic-classifier" };',
      'const checks = await Promise.all(["sample-a", "sample-b"].map(sample =>',
      '  models.classify(classifier, {',
      '    state: { sample, units: "kg/L" },',
      '    questions: { complete: { type: "bool", instructions: "Are units recorded?",',
      '      criteria: { true: "Units present", false: "Units missing" } } },',
      '  })',
      '));',
      'text({ available: reads.filter(item => item.status === "fulfilled").length,',
      '  checks: checks.map(item => item.answers.complete) });',
    ].join('\n');
    call('code-1', 'codemode', { code }, [
      { type: 'text', text: 'Script completed\nWall time 1.48 seconds\nOutput:\n' },
      { type: 'text', text: 'Invented recording: 1 sample available; 2 checks retained. The missing-file error was handled.\nAll calls, durations, and costs shown here are synthetic. Nothing ran.' },
    ], { calls: [
      { name: 'read', args: '{"path":"/fixture/sample-a.json"}', status: 'ok', durationMs: 125 },
      { name: 'read', args: '{"path":"/fixture/missing.json"}', status: 'error', durationMs: 48, error: 'Invented missing file. No file was accessed.' },
      { name: 'models.classify', args: 'fixture/synthetic-classifier · sample-a', status: 'ok', durationMs: 690, cost: 0.0012 },
      { name: 'models.classify', args: 'fixture/synthetic-classifier · sample-b', status: 'ok', durationMs: 880, cost: 0.0018 },
    ] }, false, '', 1480);
    assistant([{ type: 'text', text: 'The next card is an ordinary Bash fallback carrying a long Node script. It is separate from native codemode above. Expand it to inspect the exact recorded command and JavaScript colors.' }]);
    const shellScript = [
      "node - <<'NODE'",
      '// Synthetic recording only. This script is never executed.',
      'const paths = ["/fixture/sample-a.json", "/fixture/sample-b.json"];',
      'const records = paths.map((path, index) => ({ path, index, available: true }));',
      'console.log(JSON.stringify({ records, count: records.length }, null, 2));',
      'NODE',
    ].join('\n');
    call('bash-node-singleton', 'bash', { command: shellScript }, 'Recorded JSON output: { "count": 2, "available": true }', { exitCode: 0 }, false,
      '**Inspect the recorded script**\n\nCompare **path fields** and `count`.\n\n```javascript\nconst count = 2;\n```');
    assistant([{ type: 'text', text: 'The previous script is one action. The next failure stays separate and keeps its exact long error inside the expanded card.' }]);
    const longPathError = `Error: ENAMETOOLONG: name too long, lstat '${'/fixture/invented-long-path/'.repeat(180)}'`;
    call('bash-node-path-failure', 'bash', { command: shellScript }, longPathError, { exitCode: 1, error: longPathError }, true);
    assistant([{ type: 'text', text: 'The following four ordinary actions form a group. Expand them to compare source, diff, Markdown, and interpreter arguments with native syntax colors.' }]);
    call('source-read', 'read', { path: '/fixture/source.js' }, 'const paths = ["/fixture/a", "/fixture/b"];\nexport const count = paths.length;');
    call('source-edit', 'edit', { path: '/fixture/source.js', oldText: 'const count = 1;', newText: 'const count = 2;' }, 'Synthetic edit recorded.', { diff: '-const count = 1;\n+const count = 2;' });
    call('markdown-read', 'read', { path: '/fixture/notes.md' }, '# Recorded notes\n\n**Complete:** both samples have `kg/L` units.\n\n- Keep the warning.\n- Compare the recorded count.\n\n```javascript\nconst count = 2;\n```');
    call('bash-node-inline', 'bash', { command: `node -e 'const paths = ["/fixture/a", "/fixture/b"]; console.log(paths.length);'` }, '2', { exitCode: 0 });
    const question = {
      question: 'Which synthetic sample should the preview compare?',
      details: 'Display exercise only. Your answer does not start an analysis or approve an operation.',
      options: [
        { label: 'Sample A (Recommended)', value: 'sample-a', description: 'Inspect a complete invented record with explicit units.' },
        { label: 'Sample B', value: 'sample-b', description: 'Inspect an invented record with a missing-value warning.' },
      ],
    };
    call('question-1', 'ask_user_question', question, 'User selected: 1. Sample A (Recommended)', {
      status: 'answered', question: question.question, context: question.details, mode: 'single-select',
      answers: [{ type: 'option', label: 'Sample A (Recommended)', value: 'sample-a', index: 1 }],
    });
    call('question-other', 'ask_user_question', question, 'User selected: Other: Compare both samples and keep the warning', {
      status: 'answered', question: question.question, context: question.details, mode: 'single-select',
      answers: [{ type: 'other', label: 'Compare both samples and keep the warning', value: 'Compare both samples and keep the warning' }],
    });
    const textQuestion = { question: 'What label should this invented comparison use?', details: 'Free-text display example. The label is not saved to a report.' };
    call('question-text', 'ask_user_question', textQuestion, 'User answered: Synthetic comparison · 中文', {
      status: 'answered', question: textQuestion.question, context: textQuestion.details, mode: 'text',
      answers: [{ type: 'text', label: 'Synthetic comparison · 中文', value: 'Synthetic comparison · 中文' }],
    });
    call('failed-1', 'bash', { command: 'fixture-failure' }, 'Invented failure: sample file not found. No command ran.', { exitCode: 1 }, true);
    call('question-2', 'ask_user_question', question, 'User cancelled the question', {
      status: 'cancelled', question: question.question, context: question.details, mode: 'single-select', answers: [], message: 'User cancelled the question',
    });
    // This is the same envelope Pi writes for /skill:fixture-review, including its optional user message.
    append({ role: 'user', content: `<skill name="fixture-review" location="${path.join(skillDir, 'SKILL.md')}">\nReferences are relative to ${skillDir}.\n\n${skillBody}\n</skill>\n\nShow the native skill card and one final successful action.` });
    call('read-2', 'read', { path: '/fixture/last.txt' }, 'Recorded final output.');
    assistant([{ type: 'text', text: 'Preview controls: /inspect selects a compact block. Left/Right selects an action or thinking round; Enter expands it; Up/Down scrolls. Esc or typing returns to the editor. Ctrl+O expands native codemode and [skill] cards. /fixture-question opens the existing question UI; /fixture-question text opens free text. /fixture-permission opens a harmless approval dialog. /compact-rendering switches display. Ctrl+D exits. All records and prices are invented; no script or model ran.' }]);
    if (!questionsPath) assistant([{ type: 'text', text: 'Native question UI is unavailable on this host. Recorded question cards still show schema-shaped examples. Set PI_QUESTIONS_PATH to an existing pi-questions/index.ts to enable /fixture-question.' }]);
    if (promptJump) assistant([{ type: 'text', text: 'Prompt navigation: /prompt-jump list selects one of the three invented user prompts; /prompt-jump back returns; /prompt-jump end follows the latest output.' }]);
    manager.appendSessionInfo('compact-renderer-preview');
    const eventBus = core.createEventBus();
    const factory = async ({ sessionManager, sessionStartEvent }) => {
      const modelRuntime = await core.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      const services = await core.createAgentSessionServices({ cwd, agentDir, modelRuntime,
        resourceLoaderOptions: { eventBus, disabledBuiltinExtensions: ['codemode', 'mcp', 'tool-search', 'llama.cpp'], noContextFiles: true } });
      for (const extension of services.resourceLoader.getExtensions().extensions) {
        const question = extension.tools.get('ask_user_question');
        if (question) {
          eventBus.emit('preview:question-ui:v1', question.definition);
          question.definition = { ...question.definition, execute: async () => { throw new Error('Tool execution is disabled in this preview.'); } };
        }
      }
      const result = await core.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, noTools: 'builtin', model: modelRuntime.getModel('openai-codex', 'gpt-6-luna') });
      result.session.setActiveToolsByName([]);
      result.session.agent.streamFn = () => { throw new Error('Model calls disabled in renderer preview'); };
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await core.createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: manager });
    const diagnostics = runtime.services.resourceLoader.getExtensions().errors;
    if (runtime.diagnostics.some(item => item.type === 'error') || diagnostics.length) throw new Error(JSON.stringify([...runtime.diagnostics, ...diagnostics]));
    return { core, runtime, manager, temporary, agentDir, cwd, runtimePath, questionsPath, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await createPreview();
  let ui;
  try {
    ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen' });
    await ui.run();
  } finally { ui?.stop(); await preview.cleanup(); }
}
