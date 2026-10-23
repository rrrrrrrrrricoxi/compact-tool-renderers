import { VERSION } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen } from '@earendil-works/pi-tui';
import { chainNativeMethod } from './native-method-chain.ts';

const promptZones = /\x1b\]133;[ABC](?:\x07|\x1b\\)/g;

/** Pi 1.3 fullscreen output retains prompt markers after layout padding and
 * skips overlay composition on image anchors. Strip display-only zone markers;
 * suppress Kitty anchors while an overlay is visible so native placement cleanup
 * and restoration work. Keep source rows, layout metadata, and settings intact.
 */
export function installFullscreenOverlayGuard(tui: any, version = VERSION): () => void {
  if (version !== '1.3.0' || !['regular', 'fullscreen'].includes(tui?.mode) || typeof tui.compositeOverlays !== 'function'
    || typeof tui.hasOverlay !== 'function') return () => {};
  if (tui.mode === 'fullscreen' && typeof tui.prepareKittyScreen !== 'function') return () => {};
  // Extension UI handles are proxies with unstable method identities. Their
  // prototype is native; chain there and limit this guard to the captured terminal.
  // A regular-mode session can switch renderers without recreating its widgets.
  const proto = tui.mode === 'regular' ? TuiAltScreen.prototype as any : Object.getPrototypeOf(tui), terminal = tui.terminal;
  if (!terminal || typeof proto?.compositeOverlays !== 'function' || typeof proto.prepareKittyScreen !== 'function') return () => {};
  const detach = chainNativeMethod(proto, 'compositeOverlays', function(this: any, native, lines: string[], ...args: any[]) {
    if (this.terminal !== terminal || this.mode !== 'fullscreen') return native.call(this, lines, ...args);
    // ponytail: Pi 1.3 fullscreen only; remove when native composition is fixed.
    const hideImages = this.imageProtocol === 'kitty' && this.hasOverlay();
    const base = lines.map(line => hideImages && line.includes('\x1b_G') ? '' : line.replace(promptZones, ''));
    return native.call(this, base, ...args);
  });
  return () => { detach(); tui.requestRender?.(); };
}
