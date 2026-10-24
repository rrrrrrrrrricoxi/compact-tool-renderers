import assert from 'node:assert/strict';
import { core, loadSource } from './test-runtime.mjs';
const { supportsPiVersion, registerUnsupportedRuntime } = await loadSource('runtime-compatibility.ts');
for (const version of ['1.3.0', '1.4.0']) assert.equal(supportsPiVersion(version), true);
for (const version of ['1.2.0', '1.4.1', '1.5.0', '1.4.0-beta.1', '']) {
  const commands = new Map(), events = new Map(), notices = [];
  const pi = { registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => events.set(name, handler) };
  assert.equal(registerUnsupportedRuntime(pi, version), true);
  const ctx = { hasUI: true, ui: { notify: (message, tone) => notices.push({ message, tone }) } };
  events.get('session_start')({}, ctx);
  for (const choice of ['on', 'status', 'toggle', 'collapse', '']) await commands.get('fold').handler(choice, ctx);
  assert.equal(notices.length, 6);
  for (const notice of notices) {
    assert.match(notice.message, /Pi Fold is unavailable/);
    assert.match(notice.message, /Native display remains active/);
    assert.equal(notice.tone, 'warning');
    assert.doesNotMatch(notice.message, /Pi Fold on/);
  }
  events.get('session_start')({}, { hasUI: false });
  assert.equal(notices.length, 6, 'headless startup does not require a UI');
}
assert.equal(registerUnsupportedRuntime({}, core.VERSION), false, 'verified runtime proceeds to normal renderer registration');
console.log(`Pi ${core.VERSION}: explicit compatibility and unsupported-mode reporting passed`);
