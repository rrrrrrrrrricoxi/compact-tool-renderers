import { VERSION, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Exact versions verified by the native rendering suites. Shape checks still
// protect each private adapter; a new core version needs its own verification.
export const supportedPiVersions = ['1.3.0', '1.4.0'] as const;
export const supportsPiVersion = (version: string) => supportedPiVersions.some(supported => supported === version);

export function registerUnsupportedRuntime(pi: ExtensionAPI, version = VERSION): boolean {
  if (supportsPiVersion(version)) return false;
  const message = `Pi Fold is unavailable on Pi ${version}. Supported versions: ${supportedPiVersions.join(', ')}. Native display remains active. Update Pi Fold for support.`;
  pi.registerCommand('fold', {
    description: 'Show Pi Fold compatibility status',
    async handler(_args, ctx) { ctx.ui.notify(message, 'warning'); },
  });
  pi.on('session_start', (_event, ctx) => { if (ctx.hasUI) ctx.ui.notify(message, 'warning'); });
  return true;
}
