import { VERSION } from "@earendil-works/pi-coding-agent";
import { ScrollView, Text, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

const normalize = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
export function readableValue(value: any, depth = 0): string {
  if (depth > 12) return JSON.stringify(value);
  if (typeof value === "string") return normalize(value);
  if (value === undefined) return "[not provided]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  if (!entries.length) return JSON.stringify(value);
  return entries.map(([key, v]) => {
    const text = readableValue(v, depth + 1);
    const label = normalize(String(key));
    return v === null || typeof v !== "object" && !text.includes("\n") ? `${label}: ${text}` : `${label}:\n${text.split("\n").map(line => `  ${line}`).join("\n")}`;
  }).join("\n");
}
// Data only, never eval. Framing separators retain their own newline, including
// after decoded text leaves, so successive text() blocks cannot run together.
export function readableText(text: string): string {
  const decode = (s: string) => {
    if (s.length > 1000000) return normalize(s);
    const trailing = /\n+$/.exec(s)?.[0] || "";
    try { return readableValue(JSON.parse(s)) + trailing; } catch { return normalize(s); }
  };
  return text.split(/(==> text \d+\/\d+ <==\n)/g).map(part => /^==> text \d+\/\d+ <==\n$/.test(part) ? part : decode(part)).join("");
}
export function roundedDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Pi 1.1.0 tool slots are opaque layout leaves. Use native ScrollView clamp
 * state with local bounded painting/mouse handling, not root/core patches. */
export type PaneAction = { row: number; label: string };
export type PaneLayout = { rows: string[]; actions: PaneAction[] };
export class GroupPane implements Component {
  open = false;
  raw = false;
  expanded = false;
  private width = 1;
  private rows: string[] = [];
  private cacheKey = "";
  private actions: PaneAction[] = [];
  private footerY = 1;
  private targets: { start: number; end: number; action: string }[] = [];
  onControl: (action: string) => void = () => {};
  footerControls?: (width: number) => string[][];
  get navigation() { return this.actions; }
  private currentIndex() {
    // At a clamped jump to a short last call, report the actual topmost call.
    return Math.max(0, this.actions.findLastIndex(a => a.row <= this.scroll.scrollTop));
  }
  private cachedTheme: any;
  readonly scroll = new ScrollView({ render: () => this.rows, invalidate() {} }, { scrollbar: "always", overscroll: "contain" });
  constructor(private summary: () => string | undefined, private body: (width: number, raw: boolean) => string[] | PaneLayout, private height: () => number, private theme: () => any, private redraw: () => void, private revision: () => number = () => 0, private style: () => { frame: boolean; bodyHighlight: boolean } = () => ({ frame: true, bodyHighlight: true })) {}
  get isOpen() { return this.open || this.expanded; }
  render(width: number, expanded = false) {
    this.expanded = expanded;
    this.width = Math.max(1, width);
    const summary = this.summary();
    if (!summary) return [];
    const theme = this.theme();
    const title = theme.fg("muted", truncateToWidth(`${this.isOpen ? "▾" : "▸"} ${summary}`, this.width, "…"));
    if (!this.isOpen || VERSION !== "1.1.0") return [title];
    // Keep both frame sides outside the scroll lane. Tiny panes prioritize text.
    const framed = this.style().frame && this.width >= 3;
    const interior = this.width - (framed ? 2 : 0);
    const contentWidth = this.scroll.getContentWidth(interior);
    const chrome = (text: string, top: boolean) => {
      const left = theme.fg("border", top ? "╭" : "╰");
      const right = theme.fg("border", top ? "╮" : "╯");
      if (!this.style().frame) return truncateToWidth(text, this.width, "…");
      if (!framed) return truncateToWidth(left + text, this.width);
      const content = truncateToWidth(text, interior, "…");
      return left + content + theme.fg("border", "─".repeat(Math.max(0, interior - visibleWidth(content)))) + right;
    };
    const key = `${this.width}/${this.raw}/${this.revision()}/${this.style().frame}/${this.style().bodyHighlight}`;
    const themeRevision = theme.colors ?? theme; // Pi's public theme is a stable proxy.
    if (this.cacheKey !== key || this.cachedTheme !== themeRevision) {
      const layout = this.body(contentWidth, this.raw);
      this.rows = Array.isArray(layout) ? layout : layout.rows;
      this.actions = Array.isArray(layout) ? [] : layout.actions;
      this.cacheKey = key; this.cachedTheme = themeRevision;
    }
    const height = Math.max(0, Math.min(this.height(), this.rows.length));
    this.scroll.updateLayout(this.rows.length, height, this.redraw);
    const top = this.scroll.scrollTop;
    const thumb = Math.max(1, Math.round(height * height / Math.max(1, this.rows.length)));
    const offset = Math.round(top / Math.max(1, this.rows.length - height) * (height - thumb));
    const rows = this.rows.slice(top, top + height).map((line, i) => {
      const content = truncateToWidth(line, contentWidth);
      const lane = interior > 1 ? theme.fg(i >= offset && i < offset + thumb ? "scrollbarThumb" : "scrollbarTrack", i >= offset && i < offset + thumb ? "┃" : "│") : "";
      const painted = content + " ".repeat(Math.max(0, contentWidth - visibleWidth(content))) + lane;
      return framed ? theme.fg("border", "│") + painted + theme.fg("border", "│") : painted;
    });
    const buttons = this.footerControls?.(interior) ?? (interior >= 37 ? [["[← Previous]", "previous"], ["[Next →]", "next"], ["[Jump…]", "jump"], ["[Options]", "menu"]] : interior >= 24 ? [["[← Prev]", "previous"], ["[Next →]", "next"], ["[Jump…]", "jump"]] : interior >= 12 ? [["[←]", "previous"], ["[→]", "next"], ["[⋯]", "menu"]] : [["⋯", "menu"]]);
    let controls = "";
    this.targets = [];
    for (const [label, action] of buttons) {
      const start = visibleWidth(controls);
      if (start + visibleWidth(label) > interior) break;
      this.targets.push({ start: start + (framed ? 1 : this.style().frame ? 1 : 0), end: start + visibleWidth(label) + (framed ? 1 : this.style().frame ? 1 : 0), action });
      controls += label + " ";
    }
    this.footerY = rows.length + 1;
    const current = this.actions[this.currentIndex()];
    const indicator = current ? `${this.currentIndex() + 1}/${this.actions.length} ${current.label} · ` : "";
    return [chrome(theme.fg("muted", `▾ ${indicator}${summary}`), true), ...rows, chrome(theme.fg("muted", controls.trimEnd()), false)];
  }
  handleMouse(event: TuiMouseEvent, expanded = this.expanded) {
    if (!this.summary() || VERSION !== "1.1.0") return undefined;
    if (event.type === "click" && event.button === "left") {
      // Native expansion is owned by Pi; let its heading click collapse it.
      if (event.y === 0 && expanded) { this.open = false; return undefined; }
      if (event.y === 0) { this.open = !this.open; this.redraw(); }
      else if (this.isOpen && event.y === this.footerY) {
        const target = this.targets.find(t => event.x >= t.start && event.x < t.end);
        if (target) this.onControl(target.action);
      }
      return { handled: true };
    }
    if ((this.open || expanded) && event.type === "wheel") { this.scroll.scrollBy(event.wheelDelta || 0); return { handled: true }; }
    return undefined;
  }
  action(action: string) {
    const index = this.currentIndex();
    if (action === "previous") {
      const current = this.actions[index];
      if (current) this.scroll.scrollTo(this.scroll.scrollTop > current.row ? current.row : this.actions[Math.max(0, index - 1)].row);
    }
    else if (action === "next") { const next = this.actions[index + 1]; if (next) this.scroll.scrollTo(next.row); }
    else if (action.startsWith("jump ")) { const target = this.actions[Number(action.slice(5)) - 1]; if (target) this.scroll.scrollTo(target.row); }
    else if (action === "up") this.scroll.scrollBy(-1);
    else if (action === "down") this.scroll.scrollBy(1);
    else if (action === "page-up") this.scroll.scrollBy(-this.height());
    else if (action === "page-down") this.scroll.scrollBy(this.height());
    else if (action === "home") this.scroll.scrollToStart();
    else if (action === "end") this.scroll.scrollToEnd();
    else if (action === "raw") { this.raw = !this.raw; this.scroll.scrollToStart(); this.redraw(); }
    else if (action === "close") { this.open = false; this.redraw(); }
  }
  // Invalidations can be wheel-triggered shell redraws. Only explicit
  // content revision, width, raw mode or theme identity rebuilds body layout.
  invalidate() {}
}
export function detailRows(label: string, value: string, width: number, theme: any, color = "toolOutput") {
  const text = (label ? theme.fg("muted", label) + (value ? "\n" : "") : "") + value.split("\n").map(line => theme.fg(color, line)).join("\n");
  return text ? new Text(text, 0, 0).render(width) : [];
}
/** theme.bg only surrounds text; nested SGR 0/49 would otherwise erase it.
 * Restore just the base background after resets, never replace explicit nested
 * backgrounds or foreground/diff/syntax attributes. Skip extended color payloads.
 */
export function fillBackground(line: string, width: number, theme: any, bg: string) {
  const base = theme.bg(bg, "").replace(/\x1b\[49m$/, "");
  const content = truncateToWidth(line, width);
  const padded = content + " ".repeat(Math.max(0, width - visibleWidth(content)));
  const restored = padded.replace(/\x1b\[([0-9;:]*)m/g, (escape, parameters: string) => {
    const codes = parameters.split(";");
    let reset = false;
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i].split(":")[0]);
      if (code === 0 || code === 49) reset = true;
      else if (code >= 40 && code <= 47 || code >= 100 && code <= 107 || code === 48) reset = false;
      if ((code === 38 || code === 48 || code === 58) && !codes[i].includes(":")) {
        const mode = Number(codes[++i]);
        i += mode === 2 ? 3 : mode === 5 ? 1 : 0;
      }
    }
    return escape + (reset ? base : "");
  });
  return base + restored + "\x1b[49m";
}
export function actionCard(label: string, body: string[], width: number, theme: any, status: string, highlight = true) {
  const bg = status === "error" ? "toolErrorBg" : status === "running" || status === "queued" ? "toolPendingBg" : "toolSuccessBg";
  if (width <= 2) return new Text(label + "\n" + body.join("\n"), 0, 0).render(width).map(line => highlight ? fillBackground(line, width, theme, bg) : line);
  const title = new Text(theme.fg("toolTitle", theme.bold(label)), 0, 0).render(width - 2);
  const rows = title.map((line, i) => theme.fg("border", i === 0 ? "┌ " : "│ ") + line);
  for (const line of body) rows.push(theme.fg("border", "│ ") + line);
  rows.push(theme.fg("border", "└"));
  return rows.map((line, i) => highlight ? fillBackground(line, width, theme, bg) : i < title.length ? theme.bg(bg, line) : line);
}
