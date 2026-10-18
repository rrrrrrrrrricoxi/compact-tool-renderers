import { matchesKey, truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { activityRow, cardContentWidth } from "./display-card.ts";

/** A viewport over Pi's actual native components. No script/result text is reconstructed. */
export class CodePane {
  open = false;
  focused = false;
  offset = 0;
  title = "codemode · Preparing";
  theme?: any;
  tone = "toolTitle";
  private call?: Component;
  private result?: Component;
  private lastWidth = 0;
  private lastHeight = 0;
  constructor(private height: () => number) {}
  get nativeCall() { return this.call; }
  get nativeResult() { return this.result; }
  setNative(call?: Component, result?: Component) { this.call = call; this.result = result; }
  handle(data: string): boolean {
    if (matchesKey(data, "enter")) { this.open = !this.open; this.offset = 0; return true; }
    if (matchesKey(data, "home")) { this.open = true; this.offset = 0; return true; }
    if (["up", "down", "pageUp", "pageDown"].some(key => matchesKey(data, key as any))) {
      const down = matchesKey(data, "down") || matchesKey(data, "pageDown");
      const distance = matchesKey(data, "pageUp") || matchesKey(data, "pageDown") ? Math.max(1, this.height() - 2) : 1;
      this.open = true; this.offset = Math.max(0, this.offset + (down ? distance : -distance)); return true;
    }
    return false;
  }
  render(width: number): string[] {
    this.lastWidth = width;
    const contentWidth = cardContentWidth(width);
    const title = `${this.open ? "▾" : "▸"} ${this.title}${this.focused ? " · focused" : ""}`;
    const header = activityRow(this.theme ? this.theme.fg(this.tone, this.theme.bold(title)) : title, width, this.theme, this.focused);
    if (!this.open) { this.lastHeight = 1; return [header]; }
    const indent = contentWidth >= 4 ? "  " : "";
    const nativeWidth = Math.max(1, contentWidth - indent.length);
    const rows = [...(this.call?.render(nativeWidth) || []), ...(this.result?.render(nativeWidth) || [])];
    const bodyHeight = Math.max(1, Math.min(20, this.height()) - 2);
    this.offset = Math.min(this.offset, Math.max(0, rows.length - bodyHeight));
    const body = rows.slice(this.offset, this.offset + bodyHeight).map(row => activityRow(indent + row, width, this.theme));
    const more = this.offset + bodyHeight < rows.length;
    const footer = this.focused ? `Enter collapse · ↑/↓ scroll · Home start · Esc release${more ? " · more ↓" : ""}` : more ? "more ↓" : "";
    const visible = [header, ...body, ...(footer ? [activityRow(this.theme ? this.theme.fg("dim", truncateToWidth(footer, contentWidth)) : footer, width, this.theme)] : [])];
    this.lastHeight = visible.length;
    return visible;
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.x < 0 || event.x >= this.lastWidth || event.y < 0 || event.y >= this.lastHeight) return undefined;
    if (event.type === "wheel" && this.open && Number.isFinite(event.wheelDelta) && event.wheelDelta) {
      this.offset = Math.max(0, this.offset + Math.max(-20, Math.min(20, Math.trunc(event.wheelDelta)))); return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return undefined;
    if (event.shift || event.alt || event.ctrl) return { handled: true, render: false };
    if (event.y === 0) { this.open = !this.open; this.offset = 0; return { handled: true }; }
    return { handled: true, render: false };
  }
}
