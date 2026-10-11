import { AssistantMessageComponent, VERSION, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { ThinkingGroups } from "./thinking-groups.ts";
import { paneBodyHeight } from "./prompt-blocks.ts";

// Extractive topic preview, not a model-generated summary or transcript transformation.
// Bound work on streaming updates; do not scan an entire long reasoning block.
export function thinkingTopic(text: string): string {
  const clean = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[`*_#\[\]<>]/g, "").replace(/\s+/g, " ").trim();
  const lines = text.slice(0, 8192).split(/\r?\n/);
  const headings: string[] = [];
  for (const line of lines) {
    const match = /^\s*(?:#{1,6}\s+(.+)|\*\*([^*]+)\*\*\s*:?\s*$)/.exec(line);
    if (!match) continue;
    const heading = clean(match[1] || match[2]);
    if (heading && !headings.includes(heading)) headings.push(heading);
    if (headings.length === 2) break;
  }
  const topic = headings.length ? headings.join(" / ") : clean(lines.find(line => line.trim()) || "");
  return truncateToWidth(topic, 160, "…");
}

function thinkingRuns(message: any): string[] {
  const runs: string[] = [];
  let current: string | undefined;
  const flush = () => { if (current !== undefined) runs.push(current); current = undefined; };
  for (const block of message?.content || []) {
    if (block.type === "thinking") {
      if (typeof block.thinking !== "string" || !block.thinking.trim()) continue;
      current ??= "";
      if (current.length < 8192) current = (current + (current ? "\n\n" : "") + block.thinking.slice(0, 8192 - current.length)).slice(0, 8192);
    } else flush();
  }
  flush();
  return runs;
}

// Pi has no per-thinking-block renderer hook. Adapt only the exported component's
// hidden Text children, leaving its native Markdown, visibility state, and mouse
// callbacks untouched. Shape/version guards deliberately fail back to stock UI.
export function installThinkingPreview(getTheme: () => Theme, getMode: () => string, version = VERSION, groups?: ThinkingGroups) {
  if (version !== "1.1.0") return undefined;
  const prototype = AssistantMessageComponent.prototype as any;
  if (typeof prototype.updateContent !== "function") return undefined;
  const ownerKey = Symbol.for("notrico/compact-thinking-preview/owner");
  prototype[ownerKey]?.dispose?.();
  const original = prototype.updateContent;
  const originalRender = prototype.render;
  const mouseDescriptor = Object.getOwnPropertyDescriptor(prototype, "handleMouse");
  const originalMouse = prototype.handleMouse;
  if (typeof originalRender !== "function" || typeof originalMouse !== "function") return undefined;
  const render = function(this: any, width: number) {
    const association = !disposed && groups?.groupFor(this);
    if (!association) return originalRender.call(this, width);
    const { record, group } = association;
    // Suppress the entire owned assistant surface, including native Spacer.
    // ToolExecutionComponents are separate siblings and are never touched.
    if (group.members.at(-1) !== record) return [];
    // Restore the native assistant's one leading separator only on its visible
    // representative; suppressed rounds still render zero lines.
    return ["", ...groups!.pane(group).render(width)];
  };
  const mouse = function(this: any, event: any) {
    const association = !disposed && groups?.groupFor(this);
    if (!association) return originalMouse.call(this, event);
    if (association.group.members.at(-1) !== association.record) return undefined;
    if (event.y <= 0) return undefined; // Leading separator is not the heading.
    const result = groups!.pane(association.group).handleMouse({ ...event, y: event.y - 1, height: Math.max(0, event.height - 1) }, false);
    if (result?.handled) groups!.interact(association.group);
    return result ? { ...result, render: true } : undefined;
  };
  let disposed = false;
  const wrapped = function(this: any, ...args: any[]) {
    const result = original.apply(this, args);
    if (!disposed && groups) groups.associate(this, args[0]);
    if (disposed || getMode() === "expanded") return result;
    const children = this.contentContainer?.children;
    if (!Array.isArray(children)) return result;
    const regions = children.filter((child: any) => child instanceof MouseRegion);
    const runs = thinkingRuns(args[0]);
    if (regions.length !== runs.length) return result;
    if (runs.length && regions.every((region: MouseRegion) => region.child instanceof Text)) groups?.associate(this, args[0], true);
    regions.forEach((region: MouseRegion, index: number) => {
      if (!(region.child instanceof Text)) return; // Expanded native Markdown stays untouched.
      const topic = thinkingTopic(runs[index]);
      const label = `Thinking${topic ? ` · ${topic}` : "…"} · Ctrl+T to expand`;
      const padding = Number.isFinite(this.outputPad) ? Math.max(0, this.outputPad) : 0;
      region.child = {
        render(width: number) {
          const quiet = getMode() === "quiet";
          const pad = quiet ? 0 : Math.min(padding, Math.max(0, Math.floor((width - 1) / 2)));
          const title = quiet ? `▸ Thinking · 1 round${topic ? ` · ${topic}` : ""}` : label;
          const text = truncateToWidth(title, Math.max(1, width - pad * 2), quiet && width < 8 ? "" : "…");
          const theme = getTheme();
          return [" ".repeat(pad) + theme.italic(theme.fg("thinkingText", text))];
        },
        invalidate() {},
      };
    });
    return result;
  };
  const control = {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (prototype.updateContent === wrapped) prototype.updateContent = original;
      if (prototype.render === render) prototype.render = originalRender;
      if (prototype.handleMouse === mouse) {
        if (mouseDescriptor) Object.defineProperty(prototype, "handleMouse", mouseDescriptor);
        else delete prototype.handleMouse;
      }
      groups?.clear();
      if (prototype[ownerKey] === control) delete prototype[ownerKey];
    },
  };
  prototype.updateContent = wrapped;
  if (groups) { prototype.render = render; prototype.handleMouse = mouse; }
  prototype[ownerKey] = control;
  return control;
}

export default function registerThinkingPreview(pi: ExtensionAPI, getMode: () => string, height = () => paneBodyHeight("auto"), style = () => ({ frame: true, bodyHighlight: true })) {
  let control: ReturnType<typeof installThinkingPreview>;
  let groups: ThinkingGroups | undefined;
  let context: any;
  const rebuild = (_event: unknown, ctx: any) => {
    context = ctx;
    groups?.rebuild(ctx.sessionManager.getBranch());
  };
  pi.on("session_start", (_event, ctx) => {
    control?.dispose();
    context = ctx;
    if (ctx.mode !== "tui" || typeof ctx.ui.setHiddenThinkingLabel !== "function" || VERSION !== "1.1.0") return;
    // Pi's theme value is a stable live proxy. Retained children/panes must
    // never dereference the session ctx after its extension runner is revoked.
    const theme = ctx.ui.theme;
    groups = new ThinkingGroups(() => theme, getMode, height, style);
    groups.rebuild(ctx.sessionManager.getBranch());
    control = installThinkingPreview(() => theme, getMode, VERSION, groups);
    if (control) ctx.ui.setHiddenThinkingLabel(); // Rebuild existing UI blocks, not history.
  });
  pi.on("session_switch", rebuild);
  pi.on("session_tree", rebuild);
  pi.on("session_compact", rebuild);
  pi.on("message_start", event => { groups?.observe("start", event.message); });
  pi.on("message_update", event => { groups?.observe("update", event.message); });
  pi.on("message_end", event => { groups?.observe("end", event.message); });
  pi.on("session_shutdown", () => { control?.dispose(); control = undefined; groups = undefined; context = undefined; });
  return {
    state: () => groups?.state() || { available: false, open: false, rounds: 0 },
    action: (action: string) => {
      const acted = groups?.action(action) || false;
      if (acted) context?.ui.setHiddenThinkingLabel(); // Public command-triggered redraw; mouse uses native render:true.
      return acted;
    },
  };
}
