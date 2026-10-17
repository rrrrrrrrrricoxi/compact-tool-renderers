import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const runtime = path.resolve(process.env.PI_RUNTIME || path.join(homedir(), '.local/state/pi-config/current/runtime'));
export const agentRoot = path.resolve(process.env.PI_INSTALL_ROOT || path.join(runtime, 'node_modules/@earendil-works/pi-coding-agent'));
export const tuiRoot = path.join(path.dirname(agentRoot), 'pi-tui');
const require = createRequire(path.join(agentRoot, 'package.json'));
const { createJiti } = require('jiti');
export const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: {
  '@earendil-works/pi-coding-agent': path.join(agentRoot, 'dist/index.js'),
  '@earendil-works/pi-tui': path.join(tuiRoot, 'dist/index.js'),
} });
export const loadSource = (file) => jiti.import(new URL(file, import.meta.url).pathname);
export const loadAgent = (file) => import(pathToFileURL(path.join(agentRoot, 'dist', file)).href);
export const tui = await import(pathToFileURL(path.join(tuiRoot, 'dist/index.js')).href);
export const core = await loadAgent('index.js');
export const themeModule = await loadAgent('modes/interactive/theme/theme.js');
themeModule.initTheme('dark', false);
export const stripAnsi = value => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
