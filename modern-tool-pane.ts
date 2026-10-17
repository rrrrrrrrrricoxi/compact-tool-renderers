import { truncateToWidth, wrapTextWithAnsi, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

export type PaneAction = { id: string; label: string; sections: () => Iterable<string> };
// Render only visited text chunks. Never split/highlight an entire result to paint a viewport.
export function* textRows(text: string, width: number): Generator<string> {
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + 512);
    const newline = text.slice(offset, end).indexOf("\n");
    if (newline >= 0) end = offset + newline;
    // Keep surrogate pairs intact at chunk boundaries.
    if (end < text.length && end > offset && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const chunk = text.slice(offset, end).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\t/g, "    ");
    yield* wrapTextWithAnsi(chunk, Math.max(1, width));
    offset = end + (text[end] === "\n" ? 1 : 0);
  }
  if (!text.length) yield "(empty)";
}

/** Inline viewport. Expansion belongs to each action, never to a native renderer cache. */
export class ToolPane {
  open = false;
  focused = false;
  styleHeader = (text: string) => text;
  selected = 0;
  private anchor = 0;
  offset = 0;
  expanded = new Set<string>();
  private rows: string[] = [];
  private iterator?: Iterator<string>;
  private key = "";
  private done = false;
  private actionRows = new Map<number, number>();
  private lastWidth = 0;
  private lastHeight = 0;
  // Instrumentation also makes the large-output contract testable without wall-clock assertions.
  paintedRows = 0;
  constructor(public actions: PaneAction[], public title: string, private height = () => 12) {}
  reset() { this.anchor = Math.min(this.anchor, Math.max(0, this.actions.length - 1)); this.key = ""; this.rows = []; this.iterator = undefined; this.done = false; this.actionRows.clear(); }
  handle(data: string): boolean {
    if (data === "c") { this.open = false; return true; }
    if (data === "\r" || data === "\n" || data === " ") {
      if (!this.open) this.open = true;
      else { const id = this.actions[this.selected]?.id; if (id) this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id); }
      this.offset = 0; this.reset(); return true;
    }
    if (data === "\u001b[C" || data === "\t" || data === "\u001b[D" || data === "\u001b[Z") {
      const direction = data === "\u001b[D" || data === "\u001b[Z" ? -1 : 1;
      this.selected = (this.selected + direction + this.actions.length) % Math.max(1, this.actions.length);
      this.anchor = this.selected; this.open = true; this.offset = 0; this.reset(); return true;
    }
    if (["\u001b[A", "\u001b[B", "\u001b[5~", "\u001b[6~"].includes(data)) {
      const distance = data.includes("5") || data.includes("6") ? Math.max(1, this.height() - 4) : 1;
      const down = data === "\u001b[B" || data === "\u001b[6~";
      this.open = true; this.offset = Math.max(0, this.offset + (down ? distance : -distance)); return true;
    }
    return false;
  }
  private *body(width: number): Generator<string> {
    // Selection anchors the viewport at an action, avoiding scans through an earlier huge output.
    for (let index = this.anchor; index < this.actions.length; index++) {
      const action = this.actions[index];
      this.actionRows.set(this.rows.length, index);
      yield `${index === this.selected ? "›" : " "} ${this.expanded.has(action.id) ? "▾" : "▸"} ${index + 1}. ${action.label}`;
      if (this.expanded.has(action.id)) for (const section of action.sections()) yield* textRows(section, width);
    }
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    this.lastWidth = width;
    const header = this.styleHeader(`${this.open ? "▾" : "▸"} ${this.title}${this.focused ? " · focused" : ""}`);
    if (!this.open) { this.lastHeight = 1; return [truncateToWidth(`${header} · Alt+G to inspect`, width)]; }
    const height = Math.max(4, Math.min(20, this.height()));
    const key = `${width}:${this.anchor}:${this.selected}:${[...this.expanded].join("|")}`;
    if (key !== this.key) { this.reset(); this.key = key; this.iterator = this.body(width); }
    const bodyHeight = height - 2;
    // Clamp a seek to one viewport beyond visited content; a key press cannot scan unbounded data.
    this.offset = Math.min(this.offset, this.rows.length);
    while (!this.done && this.rows.length < this.offset + bodyHeight + 1) {
      const next = this.iterator!.next();
      if (next.done) this.done = true;
      else { this.rows.push(truncateToWidth(next.value, width)); this.paintedRows++; }
    }
    if (this.done) this.offset = Math.min(this.offset, Math.max(0, this.rows.length - bodyHeight));
    const footer = `${this.selected + 1}/${this.actions.length} · ←/→ action · Enter details · ↑/↓ scroll · c collapse · Esc release${!this.done || this.offset + bodyHeight < this.rows.length ? " · more ↓" : ""}`;
    const visible = [truncateToWidth(header, width), ...this.rows.slice(this.offset, this.offset + bodyHeight), truncateToWidth(footer, width)];
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
    if (this.open && event.y < this.lastHeight - 1 && selected !== undefined) {
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
