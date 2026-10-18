import { matchesKey, truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { richTextRows, type TextFormat } from "./modern-rich-text.ts";
import { activityRow, cardContentWidth } from "./display-card.ts";

export type PaneContent = string | { text: string; kind?: "section" | "field"; indent?: number } & TextFormat;
export type PaneAction = { id: string; label: string; sections: () => Iterable<PaneContent> };
// Render only visited text chunks. Never split/highlight an entire result to paint a viewport.
export function* textRows(text: string, width: number): Generator<string> {
  yield* richTextRows(text, width);
}

/** Inline viewport. Expansion belongs to each action, never to a native renderer cache. */
export class ToolPane {
  open = false;
  focused = false;
  styleHeader = (text: string) => text;
  theme?: any;
  background = "toolSuccessBg";
  itemName = "action";
  selected = 0;
  private anchor = 0;
  offset = 0;
  expanded = new Set<string>();
  private rows: string[] = [];
  private iterator?: Iterator<string>;
  private key = "";
  private done = false;
  private actionRows = new Map<number, number>();
  private rowKinds = new Map<number, "section" | "field">();
  private lastWidth = 0;
  private lastHeight = 0;
  private lastBodyHeight = 0;
  // Instrumentation also makes the large-output contract testable without wall-clock assertions.
  paintedRows = 0;
  constructor(public actions: PaneAction[], public title: string, private height = () => 12) {}
  private get directDetails() { return this.itemName === "action" && this.actions.length === 1; }
  reset() { this.anchor = Math.min(this.anchor, Math.max(0, this.actions.length - 1)); this.key = ""; this.rows = []; this.iterator = undefined; this.done = false; this.actionRows.clear(); this.rowKinds.clear(); }
  handle(data: string): boolean {
    if (matchesKey(data, "home")) { this.open = true; this.selected = 0; this.anchor = 0; this.offset = 0; this.reset(); return true; }
    if (matchesKey(data, "enter")) {
      if (this.directDetails) this.open = !this.open;
      else if (!this.open) this.open = true;
      else { const id = this.actions[this.selected]?.id; if (id) this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id); }
      this.offset = 0; this.reset(); return true;
    }
    if (matchesKey(data, "right") || matchesKey(data, "tab") || matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
      const direction = matchesKey(data, "left") || matchesKey(data, "shift+tab") ? -1 : 1;
      this.selected = (this.selected + direction + this.actions.length) % Math.max(1, this.actions.length);
      this.anchor = this.selected; this.open = true; this.offset = 0; this.reset(); return true;
    }
    if (["up", "down", "pageUp", "pageDown"].some(key => matchesKey(data, key as any))) {
      const distance = matchesKey(data, "pageUp") || matchesKey(data, "pageDown") ? Math.max(1, this.height() - 4) : 1;
      const down = matchesKey(data, "down") || matchesKey(data, "pageDown");
      this.open = true; this.offset = Math.max(0, this.offset + (down ? distance : -distance)); return true;
    }
    return false;
  }
  private *body(width: number): Generator<string> {
    const indent = width >= 12 ? "  " : "";
    // Selection anchors the viewport at an action, avoiding scans through an earlier huge output.
    for (let index = this.anchor; index < this.actions.length; index++) {
      const action = this.actions[index];
      if (index > this.anchor) yield "";
      const prefix = `${indent}${index === this.selected ? "›" : " "} ${this.expanded.has(action.id) ? "▾" : "▸"} ${index + 1}. `;
      if (!this.directDetails) {
        this.actionRows.set(this.rows.length, index);
        yield prefix + action.label;
      }
      const detailsIndent = this.directDetails ? indent : width >= 12 ? " ".repeat(Math.min(prefix.length, width - 1)) : "";
      if (this.directDetails || this.expanded.has(action.id)) for (const section of action.sections()) {
        const content = typeof section === "string" ? { text: section } : section;
        const indent = detailsIndent + " ".repeat(Math.min(content.indent || 0, Math.max(0, width - detailsIndent.length - 1)));
        for (const row of richTextRows(content.text, Math.max(1, width - indent.length), content)) {
          if (content.kind) this.rowKinds.set(this.rows.length, content.kind);
          yield indent + row;
        }
      }
    }
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    this.lastWidth = width;
    const outerWidth = width;
    width = cardContentWidth(width);
    const paint = (line: string, selected = false) => activityRow(this.theme ? this.theme.fg("text", line) : line, outerWidth, this.theme, selected);
    const header = this.styleHeader(`${this.open ? "▾" : "▸"} ${this.title}${this.focused ? " · focused" : ""}`);
    if (!this.open) { this.lastHeight = 1; this.lastBodyHeight = 0; return [paint(truncateToWidth(header, width), this.focused)]; }
    const height = Math.max(5, Math.min(20, this.height()));
    const key = `${width}:${this.directDetails}:${this.anchor}:${this.selected}:${[...this.expanded].join("|")}`;
    if (key !== this.key) { this.reset(); this.key = key; this.iterator = this.body(width); }
    let bodyHeight = height - (this.focused ? 2 : 1);
    // Clamp a seek to one viewport beyond visited content; a key press cannot scan unbounded data.
    this.offset = Math.min(this.offset, this.rows.length);
    while (!this.done && this.rows.length < this.offset + bodyHeight + 1) {
      const next = this.iterator!.next();
      if (next.done) this.done = true;
      else { this.rows.push(truncateToWidth(next.value, width)); this.paintedRows++; }
    }
    if (this.done) this.offset = Math.min(this.offset, Math.max(0, this.rows.length - bodyHeight));
    let more = !this.done || this.offset + bodyHeight < this.rows.length;
    if (!this.focused && more) { bodyHeight--; more = !this.done || this.offset + bodyHeight < this.rows.length; }
    const footer = this.focused ? `${this.directDetails ? "Enter collapse" : `←/→ ${this.itemName} · Enter details`} · ↑/↓ scroll · Esc release${more ? " · more ↓" : ""}` : more ? "more ↓" : "";
    const body = this.rows.slice(this.offset, this.offset + bodyHeight).map((line, index) => {
      const action = this.actionRows.get(this.offset + index);
      const selected = this.focused && action === this.selected;
      if (this.theme && action !== undefined) line = this.theme.fg(selected ? "accent" : "toolTitle", this.theme.bold(line));
      else if (this.theme && this.rowKinds.has(this.offset + index)) line = this.theme.fg("muted", this.rowKinds.get(this.offset + index) === "section" ? this.theme.bold(line) : line);
      return paint(line, selected);
    });
    const visible = [paint(truncateToWidth(header, width), this.focused), ...body, ...(footer ? [paint(truncateToWidth(this.theme ? this.theme.fg("dim", footer) : footer, width))] : [])];
    this.lastBodyHeight = body.length;
    this.lastHeight = visible.length;
    return visible;
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.x < 0 || event.x >= this.lastWidth || event.y < 0 || event.y >= this.lastHeight) return undefined;
    if (event.type === "wheel") {
      if (!this.open || !Number.isFinite(event.wheelDelta) || !event.wheelDelta) return undefined;
      this.offset = Math.max(0, this.offset + Math.max(-20, Math.min(20, Math.trunc(event.wheelDelta))));
      return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return undefined;
    // Keep text selection gestures and output clicks from falling through to native whole-row expansion.
    if (event.shift || event.alt || event.ctrl) return { handled: true, render: false };
    if (event.y === 0) { this.open = !this.open; return { handled: true }; }
    const selected = this.actionRows.get(this.offset + event.y - 1);
    if (this.open && event.y >= 1 && event.y < 1 + this.lastBodyHeight && selected !== undefined) {
      const id = this.actions[selected]?.id;
      if (id) {
        this.selected = selected;
        this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
        this.offset = 0; this.reset(); return { handled: true };
      }
    }
    return { handled: true, render: false };
  }
  invalidate() {}
}
