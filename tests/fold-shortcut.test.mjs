#!/usr/bin/env node
// Isolated synthetic preview. No model, tool, network, or active user session.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createWorkStripPreview } from '../scripts/preview-work-strip.mjs';
const preview = await createWorkStripPreview();
let ui;
try {
  const { matchesKey, setKittyProtocolActive } = await import(pathToFileURL(path.join(preview.runtimePath, 'node_modules/@earendil-works/pi-tui/dist/index.js')));
  let receive, kitty = true;
  const terminal = {
    columns: 110,
    rows: 40,
    get kittyProtocolActive() { return kitty; },
    start(onInput) { receive = onInput; },
    stop() {},
    async drainInput() {},
  };
  for (const method of ['write', 'moveBy', 'hideCursor', 'showCursor', 'clearLine', 'clearFromCursor', 'clearScreen', 'setTitle', 'setProgress', 'setProgramStatus']) terminal[method] = () => {};

  ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen', terminal });
  // Native init owns shortcut registration, input subscriptions, and focus.
  await ui.init();
  const runner = preview.runtime.session.extensionRunner;
  const errors = [];
  runner.onError(error => errors.push(error));
  const context = runner.createContext();
  const fold = runner.getCommand('fold');
  const headers = () => ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')].filter(row => row.constructor.name === 'WorkStripHeader');
  const expand = async () => {
    await fold.handler('expand', context);
    ui.renderer.renderNow();
    assert.equal(headers().length, 3);
    assert.ok(headers().every(header => header.open), 'all fixture work sections open');
  };
  const collapse = async (data, label) => {
    receive(data);
    await Promise.resolve();
    assert.ok(headers().every(header => !header.open), label);
    assert.equal(ui.renderer.getFocusedComponent(), ui.defaultEditor, `${label}: native editor retains focus`);
  };
  assert.equal(typeof receive, 'function', 'native terminal callback installed');
  assert.equal(typeof ui.defaultEditor.onExtensionShortcut, 'function', 'native startup binds extension shortcuts');
  assert.ok(runner.getShortcuts(ui.keybindings.getEffectiveConfig()).has('ctrl+alt+w'));
  assert.deepEqual(runner.getShortcutDiagnostics(), []);

  const encodings = [
    ['CSI-u', '\x1b[119;7u', true],
    ['xterm modifyOtherKeys', '\x1b[27;7;119~', false],
    ['legacy ESC plus Ctrl+W', '\x1b\x17', false],
  ];
  for (const [label, data, active] of encodings) {
    kitty = active;
    setKittyProtocolActive(active);
    assert.equal(matchesKey(data, 'ctrl+alt+w'), true, `${label}: parser matches`);
    await expand();
    ui.defaultEditor.setText('unfinished prompt');
    await collapse(data, `${label}: native terminal callback collapses work`);
    receive(data);
    await Promise.resolve();
    assert.ok(headers().every(header => header.open), `${label}: repeated key expands work`);
    assert.equal(ui.defaultEditor.getText(), 'unfinished prompt', 'shortcut preserves editor text');
  }

  kitty = true;
  setKittyProtocolActive(true);
  const choices = [];
  preview.eventBus.emit('compact-renderer:inspect:v1', { add(choice) { choices.push(choice); } });
  assert.ok(choices.length > 0);
  const owners = {};
  for (const choice of choices) {
    await expand();
    choice.focus();
    ui.renderer.renderNow();
    await collapse('\x1b[119;7u', `${choice.kind} ${choice.id}: inspection forwards shortcut`);
    owners[choice.kind] = (owners[choice.kind] || 0) + 1;
  }
  assert.deepEqual(errors, []);

  await expand();
  const dialog = context.ui.select('Choose a fixture', ['A', 'B']);
  await new Promise(resolve => setTimeout(resolve, 0));
  receive('\x1b[119;7u');
  assert.ok(headers().every(header => header.open), 'dialog retains input ownership');
  receive('\x1b');
  assert.equal(await dialog, undefined, 'Escape cancels dialog');
  await collapse('\x1b[119;7u', 'shortcut works after dialog closes');
  console.log('Pi Fold shortcut: native startup, three key encodings, repeated toggle, editor text, inspection and dialog focus passed');
} finally {
  ui?.stop();
  await preview.cleanup();
}
