import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { chainNativeMethod } from "./native-method-chain.ts";

/** Private Pi 1.3.0 seam: only pure hidden-thinking assistant containers qualify.
 * Native Ctrl+T/per-run expansion and unknown component shapes always win. */
export function hiddenThinkingShape(component: any, message: any): boolean {
  if (component.lastMessage !== message || component.hideThinkingBlock !== true || !(component.thinkingVisibilityOverrides instanceof Map)) return false;
  if ([...component.thinkingVisibilityOverrides.values()].some(value => value === false)) return false;
  const children = component.contentContainer?.children;
  let expected = 0, inRun = false, nonempty = false;
  for (const block of message?.content || []) {
    if (block.type !== "thinking") { inRun = false; nonempty = false; continue; }
    if (!inRun) { inRun = true; nonempty = false; }
    if (!nonempty && typeof block.thinking === "string" && block.thinking.trim()) { expected++; nonempty = true; }
  }
  return Array.isArray(children) && children.filter((c: any) => c instanceof MouseRegion).length === expected && children.every((c: any) => c instanceof Spacer || c instanceof MouseRegion && c.child instanceof Text);
}
export function installModernThinkingAdapter(hooks: {
  associate(component: any, message: any): void;
  render(component: any, width: number): string[] | undefined;
  mouse(component: any, event: any): any;
  clear(): void;
}, version = VERSION): (() => void) | undefined {
  const proto = AssistantMessageComponent.prototype as any;
  if (version !== "1.3.0" || !["updateContent", "render", "setHideThinkingBlock"].every(key => typeof proto[key] === "function")) return;
  const owner = Symbol.for("compact-renderer:thinking-adapter:v1");
  proto[owner]?.();
  let disposed = false;
  const detachUpdate = chainNativeMethod(proto, "updateContent", function(this: any, update, ...args: any[]) { const value = update.apply(this, args); if (!disposed) hooks.associate(this, args[0]); return value; });
  const detachRender = chainNativeMethod(proto, "render", function(this: any, render, width: number) { return !disposed && hooks.render(this, width) || render.call(this, width); });
  const detachMouse = chainNativeMethod(proto, "handleMouse", function(this: any, mouse, event: any) { const result = !disposed && hooks.mouse(this, event); return result || mouse?.call(this, event); });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    detachMouse(); detachRender(); detachUpdate();
    if (proto[owner] === dispose) delete proto[owner];
    hooks.clear();
  };
  proto[owner] = dispose;
  return dispose;
}
