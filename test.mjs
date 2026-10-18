#!/usr/bin/env node
// Every test runs in a fresh process: native prototype adapters cannot mask cleanup failures in other suites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const directory = path.dirname(fileURLToPath(import.meta.url));
const required = ['action-intent.test.mjs', 'modern-workflows.test.mjs', 'display-mode.test.mjs', 'modern-tools.test.mjs', 'modern-subagent-messages.test.mjs', 'subagent-spacing.test.mjs', 'modern-subagent-groups.test.mjs', 'modern-thinking.test.mjs', 'modern-prompts.test.mjs', 'permission-presentation.test.mjs', 'input-focus.test.mjs', 'inspection.test.mjs', 'codemode.test.mjs', 'preview-example.test.mjs'];
for (const name of required) {
  if (!fs.existsSync(path.join(directory, name))) throw new Error(`Missing required regression suite: ${name}`);
  const result = spawnSync(process.execPath, [path.join(directory, name)], { cwd: directory, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Standalone compact renderer native regression suites passed');
