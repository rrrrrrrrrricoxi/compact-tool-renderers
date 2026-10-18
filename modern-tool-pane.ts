import { matchesKey, truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { richTextRows, type TextFormat } from "./modern-rich-text.ts";
import { activityRow, cardContentWidth } from "./display-card.ts";

type RowKind = "section" | "field" | "answer";
export type PaneContent = string | { text: string; kind?: RowKind; indent?: number; label?: string } & TextFormat;
export type PaneAction = { id: string; label: string; sections: () => Iterable<PaneContent>; details?: () => Iterable<PaneContent> };
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
  headingTone = "mdLink";
  itemName = "action";
  selected = 0;
  private anchor = 0;
  offset = 0;
  expanded = new Set<string>();
  detailsExpanded = new Set<string>();
  private detailsFocused = false;
  private rows: string[] = [];
  private iterator?: Iterator<string>;
  private key = "";
  private done = false;
  private actionRows = new Map<number, number>();
  private detailsRows = new Map<number, number>();
  private contentAnchoredAbove = false;
  private rowKinds = new Map<number, RowKind>();
  private lastWidth = 0;
  private lastHeight = 0;
  private lastBodyHeight = 0;
  // Instrumentation also makes the large-output contract testable without wall-clock assertions.
  paintedRows = 0;
  constructor(public actions: PaneAction[], public title: string, private height = () => 12) {}
  private get directDetails() { return this.itemName === "action" && this.actions.length === 1; }
  reset() { this.anchor = Math.min(this.anchor, Math.max(0, this.actions.length - 1)); this.key = ""; this.rows = []; this.iterator = undefined; this.done = false; this.actionRows.clear(); this.detailsRows.clear(); this.rowKinds.clear(); }
  releaseInspection() { if (this.detailsFocused) { this.detailsFocused = false; this.offset = 0; this.reset(); } }
  handle(data: string): boolean {
    if (matchesKey(data, "home")) { this.open = true; this.selected = 0; this.detailsFocused = false; this.anchor = 0; this.offset = 0; this.reset(); return true; }
    if (matchesKey(data, "enter")) {
      const action = this.actions[this.selected];
      if (this.detailsFocused && action?.details) {
        this.detailsExpanded.has(action.id) ? this.detailsExpanded.delete(action.id) : this.detailsExpanded.add(action.id);
      }
      else if (this.directDetails) this.open = !this.open;
      else if (!this.open) this.open = true;
      else { const id = this.actions[this.selected]?.id; if (id) this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id); }
      this.offset = 0; this.reset(); return true;
    }
    if ((matchesKey(data, "tab") || matchesKey(data, "shift+tab")) && this.actions[this.selected]?.details) {
      this.open = true; this.anchor = this.selected; this.expanded.add(this.actions[this.selected].id);
      this.detailsFocused = !this.detailsFocused;
      this.offset = 0; this.reset(); return true;
    }
    if (matchesKey(data, "right") || matchesKey(data, "tab") || matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
      const direction = matchesKey(data, "left") || matchesKey(data, "shift+tab") ? -1 : 1;
      this.selected = (this.selected + direction + this.actions.length) % Math.max(1, this.actions.length);
      this.detailsFocused = false; this.anchor = this.selected; this.open = true; this.offset = 0; this.reset(); return true;
    }
    if (["up", "down", "pageUp", "pageDown"].some(key => matchesKey(data, key as any))) {
      const distance = matchesKey(data, "pageUp") || matchesKey(data, "pageDown") ? Math.max(1, this.height() - 4) : 1;
      const down = matchesKey(data, "down") || matchesKey(data, "pageDown");
      if (!down && this.contentAnchoredAbove && this.detailsFocused && this.offset === 0) { this.releaseInspection(); return true; }
      this.open = true; this.offset = Math.max(0, this.offset + (down ? distance : -distance)); return true;
    }
    return false;
  }
  private *body(width: number): Generator<string> {
    this.contentAnchoredAbove = false;
    const indent = width >= 12 ? "  " : "";
    // Selection anchors the viewport at an action, avoiding scans through an earlier huge output.
    for (let index = this.anchor; index < this.actions.length; index++) {
      const action = this.actions[index];
      const prefix = `${indent}${index === this.selected ? "›" : " "} ${this.expanded.has(action.id) ? "▾" : "▸"} ${index + 1}. `;
      if (!this.directDetails) {
        this.actionRows.set(this.rows.length, index);
        yield prefix + action.label;
      }
      const detailsIndent = this.directDetails ? indent : width >= 12 ? " ".repeat(Math.min(prefix.length, width - 1)) : "";
      if (this.directDetails || this.expanded.has(action.id)) {
        const sectionRows = function* (this: ToolPane, sections: Iterable<PaneContent>) {
          for (const section of sections) {
            const content = typeof section === "string" ? { text: section } : section;
            const indent = detailsIndent + " ".repeat(Math.min(content.indent || 0, Math.max(0, width - detailsIndent.length - 1)));
            const label = content.label ? `${content.label} ` : "";
            let first = true;
            for (const row of richTextRows(content.text, Math.max(1, width - indent.length - label.length), content)) {
              yield { text: indent + (first && label ? this.theme ? this.theme.fg("muted", label) : label : " ".repeat(label.length)) + row, kind: content.kind };
              first = false;
            }
          }
        }.bind(this);
        const emitRows = function* (this: ToolPane, rows: Iterable<{ text: string; kind?: RowKind }>) {
          for (const row of rows) { if (row.kind) this.rowKinds.set(this.rows.length, row.kind); yield row.text; }
        }.bind(this);
        if (this.detailsFocused && index === this.selected) {
          // Keep short output inline; probe at most one viewport before anchoring at Details.
          const primary = sectionRows(action.sections()), preview = [];
          const budget = Math.max(1, Math.min(20, this.height()) - (this.focused ? 2 : 1) - (this.directDetails ? 0 : 1) - 1);
          let complete = false;
          while (preview.length <= budget) { const row = primary.next(); if (row.done) { complete = true; break; } preview.push(row.value); }
          if (complete) yield* emitRows(preview);
          else { this.contentAnchoredAbove = true; yield detailsIndent + (this.theme ? this.theme.fg("dim", "content above ↑") : "content above ↑"); }
        } else yield* emitRows(sectionRows(action.sections()));
        if (action.details) {
          this.detailsRows.set(this.rows.length, index);
          yield detailsIndent + `${this.detailsExpanded.has(action.id) ? "▾" : "▸"} Details`;
          if (this.detailsExpanded.has(action.id)) yield* emitRows(sectionRows(action.details()));
        }
      }
    }
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    this.lastWidth = width;
    const outerWidth = width;
    width = cardContentWidth(width);
    const paint = (line: string, selected = false) => {
      line = this.theme ? this.theme.fg("text", line) : line;
      return activityRow(line, outerWidth, this.theme, selected);
    };
    const header = this.styleHeader(`${this.open ? "▾" : "▸"} ${this.title}${this.focused ? " · focused" : ""}`);
    if (!this.open) { this.lastHeight = 1; this.lastBodyHeight = 0; return [paint(truncateToWidth(header, width), this.focused && !this.detailsFocused)]; }
    const height = Math.max(5, Math.min(20, this.height()));
    const key = `${width}:${this.directDetails}:${this.anchor}:${this.selected}:${[...this.expanded].join("|")}:${[...this.detailsExpanded].join("|")}:${this.detailsFocused}`;
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
    const selectedAction = this.actions[this.selected];
    const detailsTarget = this.detailsFocused && !!selectedAction?.details;
    const isExpanded = detailsTarget ? this.detailsExpanded.has(selectedAction.id) : this.directDetails || this.expanded.has(selectedAction?.id);
    const controls = detailsTarget ? `Enter ${isExpanded ? "collapse" : "expand"} Details · Tab action` : `${this.directDetails ? "Enter collapse" : `←/→ ${this.itemName} · Enter ${isExpanded ? "collapse" : "expand"}`}${selectedAction?.details ? " · Tab Details" : ""}`;
    const footer = this.focused ? `${controls} · ↑/↓ scroll · Esc release${more ? " · more ↓" : ""}` : more ? "more ↓" : "";
    const body = this.rows.slice(this.offset, this.offset + bodyHeight).map((line, index) => {
      const action = this.actionRows.get(this.offset + index);
      const details = this.detailsRows.get(this.offset + index);
      const selected = this.focused && (this.detailsFocused ? details === this.selected : action === this.selected);
      if (this.theme && (action !== undefined || details !== undefined)) line = this.theme.fg(selected ? "accent" : this.headingTone, this.theme.bold(line));
      else if (this.theme && this.rowKinds.has(this.offset + index)) {
        const kind = this.rowKinds.get(this.offset + index);
        line = this.theme.fg(kind === "answer" ? "success" : "muted", kind === "field" ? line : this.theme.bold(line));
      }
      return paint(line, selected);
    });
    const visible = [paint(truncateToWidth(header, width), this.focused && !this.detailsFocused), ...body, ...(footer ? [paint(truncateToWidth(this.theme ? this.theme.fg("dim", footer) : footer, width))] : [])];
    this.lastBodyHeight = body.length;
    this.lastHeight = visible.length;
    return visible;
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.x < 0 || event.x >= this.lastWidth || event.y < 0 || event.y >= this.lastHeight) return undefined;
    if (event.type === "wheel") {
      if (!this.open || !Number.isFinite(event.wheelDelta) || !event.wheelDelta) return undefined;
      if (event.wheelDelta < 0 && this.contentAnchoredAbove && this.offset === 0) this.releaseInspection();
      else this.offset = Math.max(0, this.offset + Math.max(-20, Math.min(20, Math.trunc(event.wheelDelta))));
      return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return undefined;
    // Keep text selection gestures and output clicks from falling through to native whole-row expansion.
    if (event.shift || event.alt || event.ctrl) return { handled: true, render: false };
    if (event.y === 0) { this.detailsFocused = false; this.open = !this.open; return { handled: true }; }
    const details = this.detailsRows.get(this.offset + event.y - 1);
    if (this.open && event.y >= 1 && event.y < 1 + this.lastBodyHeight && details !== undefined) {
      const id = this.actions[details]?.id;
      if (id) {
        this.selected = details; this.anchor = details; this.detailsFocused = true; this.offset = 0;
        this.detailsExpanded.has(id) ? this.detailsExpanded.delete(id) : this.detailsExpanded.add(id);
        this.reset(); return { handled: true };
      }
    }
    const selected = this.actionRows.get(this.offset + event.y - 1);
    if (this.open && event.y >= 1 && event.y < 1 + this.lastBodyHeight && selected !== undefined) {
      const id = this.actions[selected]?.id;
      if (id) {
        this.selected = selected; this.detailsFocused = false;
        this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
        this.offset = 0; this.reset(); return { handled: true };
      }
    }
    return { handled: true, render: false };
  }
  invalidate() {}
}
