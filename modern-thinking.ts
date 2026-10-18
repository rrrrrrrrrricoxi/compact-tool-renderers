import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { hiddenThinkingShape, installModernThinkingAdapter } from "./modern-thinking-adapter.ts";
import { RecordedTextPane, recordedPaneHeight } from "./modern-recorded-pane.ts";
import { cardBlock, cardContentWidth, cardRow } from "./display-card.ts";

type Mode = { isEnabled(): boolean; onChange(callback: () => void): () => void };
type Round = { message: any; component?: any; kind: "round" | "bridge" | "boundary"; group?: ThinkingGroup };
type ThinkingGroup = { members: Round[]; pane: RecordedTextPane; activeEpoch?: number; activeResult?: boolean };
const hasThinking = (message: any) => (message?.content || []).some((b: any) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim());
const classify = (message: any): Round["kind"] => {
  if (["error", "aborted", "length"].includes(message?.stopReason) || (message?.content || []).some((b: any) => b.type === "text" && b.text?.trim() || b.type === "toolCall" && ["ask_user_question", "question"].includes(b.name))) return "boundary";
  return hasThinking(message) ? "round" : "bridge";
};
const boundary = (m: any) => m?.role === "toolResult" ? !!m.isError || ["ask_user_question", "question"].includes(m.toolName) || ["cancelled", "unavailable"].includes(m.details?.status) && m.toolName === "ask_user_question" : !["system"].includes(m?.role) && !(m?.role === "custom" && m.display === false);

/** Recorded object identity and public event order determine membership. No content
 * matching, generated summaries, transcript writes, or model calls. */
export class ModernThinkingGroups {
  private records: (Round | null)[] = [];
  private aliases = new WeakMap<object, Round>();
  private components = new WeakMap<object, Round>();
  private boundaries = new WeakSet<object>();
  private live?: Round;
  private dirty = true;
  private epoch = 0;
  private groups: ThinkingGroup[] = [];
  private selected?: ThinkingGroup;
  private layouts = new WeakMap<object, { width: number; height: number }>();
  focused = false;
  constructor(private enabled: () => boolean, private theme: () => any, private focus: () => void) {}
  clear() { this.records = []; this.aliases = new WeakMap(); this.components = new WeakMap(); this.boundaries = new WeakSet(); this.layouts = new WeakMap(); this.live = undefined; this.groups = []; this.selected = undefined; this.focused = false; this.dirty = true; this.epoch++; }
  rebuild(entries: readonly any[]) {
    this.clear();
    for (const entry of entries) {
      if (entry.type === "message") this.observe("end", entry.message);
      else if (["compaction", "branch_summary"].includes(entry.type) || entry.type === "custom_message" && entry.display !== false) this.records.push(null);
    }
  }
  observe(phase: "start" | "update" | "end", message: any) {
    if (!message || typeof message !== "object") return;
    this.epoch++;
    if (message.role !== "assistant") {
      if (boundary(message) && !this.boundaries.has(message)) { this.records.push(null); this.boundaries.add(message); this.live = undefined; this.dirty = true; }
      return;
    }
    let record = this.aliases.get(message) || (phase === "start" ? undefined : this.live);
    if (!record) { record = { message, kind: classify(message) }; this.records.push(record); this.dirty = true; }
    record.message = message; this.aliases.set(message, record);
    const kind = classify(message);
    if (record.kind !== kind) { record.kind = kind; this.dirty = true; }
    this.live = phase === "end" ? undefined : record;
  }
  associate(component: any, message: any) {
    this.epoch++;
    const previous = this.components.get(component), record = this.aliases.get(message);
    if (previous && previous !== record && previous.component === component) previous.component = undefined;
    if (!record) { this.components.delete(component); return; }
    if (record.component && record.component !== component) this.components.delete(record.component);
    record.component = component; this.components.set(component, record);
  }
  private regroup() {
    if (!this.dirty) return;
    this.dirty = false;
    const previous = new Map(this.groups.map(group => [group.members[0], group]));
    this.groups = [];
    let members: Round[] = [];
    const flush = () => {
      if (!members.length) return;
      const group = previous.get(members[0]) || { members: [], pane: new RecordedTextPane() };
      group.members = members;
      for (const record of members) record.group = group;
      this.groups.push(group); members = [];
    };
    for (const record of this.records) {
      if (record) record.group = undefined;
      if (!record || record.kind === "boundary") flush();
      else if (record.kind === "round") members.push(record);
    }
    flush();
    if (this.selected && !this.groups.includes(this.selected)) { this.selected = undefined; this.focused = false; }
  }
  private active(group?: ThinkingGroup): group is ThinkingGroup {
    if (!group || !this.enabled()) return false;
    if (group.activeEpoch !== this.epoch) {
      group.activeResult = group.members.every(record => record.component && this.components.get(record.component) === record && classify(record.message) === "round" && hiddenThinkingShape(record.component, record.message));
      group.activeEpoch = this.epoch;
    }
    return group.activeResult === true;
  }
  association(component: any) {
    this.regroup();
    const record = this.components.get(component);
    if (record && !hiddenThinkingShape(component, record.message)) this.epoch++;
    return record && record.component === component && this.active(record.group) ? { record, group: record.group } : undefined;
  }
  private choose(group: ThinkingGroup) { this.selected = group; this.focused = true; this.focus(); }
  private sources(group: ThinkingGroup) {
    const refs: string[] = [];
    group.members.forEach((record, i) => {
      refs.push(`Round ${i + 1}/${group.members.length}`);
      for (const block of record.message.content) if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) refs.push(block.thinking);
    });
    group.pane.setSources(refs);
  }
  render(component: any, width: number): string[] | undefined {
    const match = this.association(component);
    if (!match) return;
    const { record, group } = match;
    if (group.members.at(-1) !== record) return [];
    const pane = group.pane, focused = this.focused && this.selected === group;
    width = Math.max(1, width);
    const theme = this.theme(), innerWidth = cardContentWidth(width);
    const label = `${pane.open ? "▾" : "▸"} Thinking · ${group.members.length} round${group.members.length === 1 ? "" : "s"}${focused ? " · focused · Enter toggles · Esc releases" : ""}`;
    const paint = (line: string, heading = false) => cardRow(theme.fg(heading ? "accent" : "text", heading ? theme.bold(truncateToWidth(line, innerWidth, "…")) : truncateToWidth(line, innerWidth, "…")), width, theme, "customMessageBg");
    const content = [paint(label, true)];
    if (pane.open) {
      this.sources(group);
      const indent = innerWidth >= 12 ? "  " : "";
      content.push(...pane.view(Math.max(1, innerWidth - indent.length), recordedPaneHeight()).map(line => paint(indent + line)));
      content.push(paint(focused ? `↑/↓ scroll · Home first · ${pane.more ? "more below" : "end"} · Ctrl+T native` : `${pane.more ? "More below · " : ""}Alt+T to inspect`));
    }
    const rows = ["", ...cardBlock(content, width, theme, "customMessageBg")];
    this.layouts.set(component, { width, height: rows.length });
    return rows;
  }
  mouse(component: any, event: any) {
    const match = this.association(component);
    const layout = this.layouts.get(component);
    if (!match || match.group.members.at(-1) !== match.record || !layout || event.x < 0 || event.x >= layout.width || event.y < 1 || event.y >= layout.height) return;
    if (event.type === "click" && event.button === "left" && event.y === 2) { this.focused = false; this.focus(); match.group.pane.open = !match.group.pane.open; return { handled: true, render: true }; }
    if (event.type === "wheel" && match.group.pane.open) { this.focused = false; this.focus(); match.group.pane.move(event.wheelDelta > 0 ? "down" : "up", recordedPaneHeight()); return { handled: true, render: true }; }
    if (event.type === "click" && event.button === "left") return { handled: true, render: false };
  }
  input(data: string): boolean {
    if (!this.enabled()) { this.focused = false; return false; }
    this.regroup();
    if (matchesKey(data, "alt+t")) {
      const active = this.groups.filter(group => this.active(group));
      if (!active.length) return false;
      const index = this.focused ? active.indexOf(this.selected!) : -1;
      this.choose(index < 0 ? active.at(-1)! : active[(index + active.length - 1) % active.length]);
      return true;
    }
    if (!this.focused || !this.active(this.selected)) { this.focused = false; return false; }
    if (matchesKey(data, "escape")) { this.focused = false; return true; }
    if (matchesKey(data, "enter")) { this.selected.pane.open = !this.selected.pane.open; return true; }
    if (!this.selected.pane.open) { this.focused = false; return false; }
    for (const direction of ["up", "down", "pageUp", "pageDown", "home"] as const) if (matchesKey(data, direction)) { this.selected.pane.move(direction, recordedPaneHeight()); return true; }
    this.focused = false;
    return false;
  }
}

export function registerModernThinking(pi: ExtensionAPI, mode: Mode): () => void {
  const owner = Symbol.for("compact-renderer:thinking-registration:v1"), shared = globalThis as any;
  shared[owner]?.();
  let groups: ModernThinkingGroups | undefined, adapter: (() => void) | undefined, input: (() => void) | undefined;
  let redraw: (() => void) | undefined, disposed = false;
  const stop = () => { input?.(); input = undefined; adapter?.(); adapter = undefined; groups?.clear(); groups = undefined; redraw = undefined; };
  const rebuild = (_event: unknown, ctx: any) => {
    if (disposed) return;
    stop();
    if (ctx.mode !== "tui" || typeof ctx.ui.setHiddenThinkingLabel !== "function") return;
    const ui = ctx.ui, theme = ui.theme;
    groups = new ModernThinkingGroups(() => mode.isEnabled(), () => theme, () => pi.events.emit("compact-renderer:focus:v1", { owner: "thinking" }));
    // Match the native transcript sequence, including retained compaction entries.
    const sessions = ctx.sessionManager;
    groups.rebuild(typeof sessions.buildContextEntries === "function" ? sessions.buildContextEntries() : sessions.getBranch());
    adapter = installModernThinkingAdapter({ associate: (c, m) => groups?.associate(c, m), render: (c, w) => groups?.render(c, w), mouse: (c, e) => groups?.mouse(c, e), clear: () => groups?.clear() });
    if (!adapter) { groups.clear(); groups = undefined; return; }
    redraw = () => ui.setHiddenThinkingLabel();
    input = ui.onTerminalInput?.((data: string) => {
      const wasFocused = groups?.focused;
      if (groups?.input(data)) { redraw?.(); return { consume: true }; }
      if (wasFocused && !groups?.focused) redraw?.();
    });
    redraw();
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ["session_start", "session_tree", "session_compact"] as const) subscriptions.push(pi.on(event, rebuild));
  for (const [event, phase] of [["message_start", "start"], ["message_update", "update"], ["message_end", "end"]] as const) subscriptions.push(pi.on(event, (event: any) => groups?.observe(phase, event.message)));
  subscriptions.push(pi.on("ui_prompt_start", () => { if (groups) groups.focused = false; }));
  subscriptions.push(pi.on("session_shutdown", stop));
  subscriptions.push(pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "thinking" && groups) groups.focused = false; }));
  subscriptions.push(mode.onChange(() => { if (groups) groups.focused = false; redraw?.(); }));
  const dispose = () => { if (disposed) return; disposed = true; for (const unsub of subscriptions) unsub?.(); const repaint = redraw; stop(); if (shared[owner] === dispose) delete shared[owner]; repaint?.(); };
  shared[owner] = dispose;
  return dispose;
}
