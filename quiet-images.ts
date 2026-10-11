import { ToolExecutionComponent, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image, Spacer } from "@earendil-works/pi-tui";

const ownerKey = Symbol.for("notrico/compact-quiet-images/owner");
/** Pi 1.1.0 appends native images independently of per-tool renderers and
 * expansion. Gate their paint only: never change content, policy, conversion,
 * native image instances/sources or reuse, and never add our own Image. */
export function installQuietImages(getMode: () => string, version = VERSION) {
  if (version !== "1.1.0") return undefined;
  const proto = ToolExecutionComponent.prototype as any;
  if (typeof proto.render !== "function") return undefined;
  proto[ownerKey]?.dispose?.();
  const original = proto.render;
  let disposed = false;
  const shape = (card: any) => typeof card.expanded === "boolean" && typeof card.showImages === "boolean" &&
    Array.isArray(card.children) && Array.isArray(card.imageComponents) && card.imageComponents.every((c: any) => c instanceof Image) &&
    Array.isArray(card.imageSpacers) && card.imageSpacers.every((c: any) => c instanceof Spacer) && Array.isArray(card.imageSources) &&
    typeof card.getRenderShell === "function" && Array.isArray(card.result?.content);
  const render = function(this: any, width: number) {
    if (disposed || getMode() !== "quiet" || this.expanded || this.toolName === "ask_user_question" || !shape(this) || !this.imageComponents.length) return original.call(this, width);
    const images = this.imageComponents, spacers = this.imageSpacers, children = this.children;
    // Native self-shell reads the arrays; the default shell reads children.
    // Synchronous local paint substitution is restored even if native paint fails.
    this.imageComponents = []; this.imageSpacers = [];
    this.children = children.filter((c: any) => !images.includes(c) && !spacers.includes(c));
    try { return original.call(this, width); }
    finally { this.imageComponents = images; this.imageSpacers = spacers; this.children = children; }
  };
  const control = { dispose() {
    if (disposed) return;
    disposed = true;
    if (proto.render === render) proto.render = original;
    if (proto[ownerKey] === control) delete proto[ownerKey];
  } };
  proto.render = render; proto[ownerKey] = control;
  return control;
}

export default function registerQuietImages(pi: ExtensionAPI, getMode: () => string) {
  let control: ReturnType<typeof installQuietImages>;
  pi.on("session_start", (_event, ctx) => {
    control?.dispose(); control = undefined;
    if (ctx.mode === "tui") control = installQuietImages(getMode);
  });
  pi.on("session_shutdown", () => { control?.dispose(); control = undefined; });
}
