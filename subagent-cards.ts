import { CustomMessageComponent, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GroupPane, fillBackground } from "./group-pane.ts";
import { paneBodyHeight } from "./prompt-blocks.ts";

export type ReportTarget = {
  valid(): boolean;
  state(): { kind: "report"; label: string; available: boolean; open: boolean; raw: boolean; scrollable: boolean; actions: readonly { row: number; label: string }[] };
  action(action: string): boolean;
};
export type ReportControls = {
  height?: () => number;
  style?: () => { frame: boolean; bodyHighlight: boolean };
  redraw?: () => void;
  onInteract?: (target: ReportTarget) => void;
  onControl?: (action: string) => void;
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Word wrapping trims whitespace and a two-column glyph cannot fit a one-column
// terminal. Literal wrapping preserves source spacing; unpaintable graphemes and
// terminal control bytes are escaped rather than silently clipped or executed.
export function wrapRecordedLine(text: string, width: number): string[] {
  const literal = text.replace(/[\p{Cc}]/gu, char => JSON.stringify(char).slice(1, -1));
  const lines: string[] = [];
  let line = "", columns = 0;
  const append = (part: string) => {
    const size = visibleWidth(part);
    if (columns + size > width && line) { lines.push(line); line = ""; columns = 0; }
    line += part; columns += size;
  };
  for (const { segment } of graphemes.segment(literal)) {
    if (visibleWidth(segment) > width) {
      const escaped = segment.split("").map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
      for (const char of escaped) append(char);
    } else append(segment);
  }
  lines.push(line);
  return lines;
}

const clean = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
function completionPrefix(message: any) {
  const d = message.details || {};
  const name = String(d.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^Sub-agent "${name}" (?:completed \\([\\dsmh .]+\\)|failed \\(exit code ${d.exitCode}\\)|failed after [\\dsmh .]+ \\(provider/agent error — auto-retry exhausted\\))\\.$`);
}
export function readableReport(message: any): string {
  if (message.customType === "subagent_question") return message.details.question;
  let text = message.content;
  const first = text.split("\n", 1)[0];
  if (completionPrefix(message).test(first)) text = text.slice(first.length).replace(/^\n\n/, "");
  const followup = `\n\nFollow up with subagent_message({ name: "${message.details.name}", message: "…" })`;
  if (text.endsWith(followup)) text = text.slice(0, -followup.length);
  return text;
}
export function rawReportRows(message: any, width: number, theme: any): string[] {
  const metadata = Object.fromEntries(Object.entries(message).filter(([key]) => key !== "content"));
  return [...wrapRecordedLine("Original report (literal; controls/unpaintable glyphs escaped):", width),
    ...message.content.split("\n").flatMap((line: string) => wrapRecordedLine(line, width)),
    ...wrapRecordedLine("Recorded metadata (JSON):", width),
    ...JSON.stringify(metadata, null, 2).split("\n").flatMap(line => wrapRecordedLine(line, width))].map(line => theme.fg("toolOutput", line));
}
// Extractive, bounded display text only; never infer the task or request a summary.
export function reportExcerpt(message: any): string {
  if (typeof message?.content !== "string") return "";
  const d = message.details || {};
  const nativePrefix = completionPrefix(message);
  const source = message.customType === "subagent_question" ? d.question : message.content;
  for (const raw of String(source || "").slice(0, 8192).replace(/[\ud800-\udbff]$/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || nativePrefix.test(line) || line === `Follow up with subagent_message({ name: "${d.name}", message: "…" })` || /^```|^~~~|^(?:[-*_]\s*){3,}$/.test(line)) continue;
    const text = clean(line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, ""));
    if (!text || /^(?:changes|summary|results?|report|details|findings|outcome)\s*:?[.!]?$/i.test(text)) continue;
    return truncateToWidth(text, 160, "…");
  }
  return "";
}

const ownerKey = Symbol.for("notrico/compact-subagent-cards/owner");
const cardKey = Symbol("compact-subagent-card");
const paneKey = Symbol("compact-subagent-report-pane");
// Persisted JSON only: do not silently drop undefined, attachments, getters, cycles,
// non-finite numbers or fields JSON.stringify cannot preserve.
function recordedJSON(value: any, seen = new Set<any>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  seen.add(value);
  const valid = Reflect.ownKeys(value).every(key => {
    if (Array.isArray(value) && key === "length") return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === "string" && descriptor.enumerable && "value" in descriptor && recordedJSON(descriptor.value, seen);
  });
  seen.delete(value);
  return valid;
}
function statusLines(message: any): { name: string; elapsed: string; detail: string; attention: boolean }[] | undefined {
  const d = message?.details;
  if (message?.customType !== "subagent_status" || typeof message.content !== "string" || !d || !recordedJSON(message) || Object.keys(d).some(key => !["lines", "overflow"].includes(key)) || !Array.isArray(d.lines) || !d.lines.length || !Number.isInteger(d.overflow) || d.overflow < 0) return undefined;
  const expected = "Subagent status:\n" + [...d.lines.map((line: any) => `• ${line}`), ...(d.overflow ? [`• +${d.overflow} more running.`] : [])].join("\n");
  if (message.content !== expected) return undefined;
  const lines = d.lines.map((line: any) => {
    if (typeof line !== "string" || /[\p{Cc}\p{Cf}]/u.test(line)) return undefined;
    // Match the installed formatter's integer elapsed/phase grammar, not an
    // arbitrary suffix beginning with a familiar word. Truncated lines and
    // unknown phases stay native. Activity labels themselves are free text.
    const duration = "(?:\\d+s|\\d+m|\\d+h \\d+m)";
    const active = "active(?: \\([^()]+\\))?";
    const waiting = `waiting(?: ${duration})?(?: \\(done|wrong activity id\\))?`;
    const detail = `(?:starting(?: \\(wrong activity id\\))?|${active}|${waiting}|stalled(?: ${duration})?(?: \\(wrong activity id\\))?|recovered; (?:${active}|waiting(?: ${duration})?))`;
    const match = new RegExp(`^(.+) running (${duration})(?:, (${detail}))?\\.$`).exec(line);
    if (!match || match[1].length > 72 || line.length > 120 || /\b(?:question|approval|requires action|awaiting input)\b/i.test(match[3] || "")) return undefined;
    return { name: match[1], elapsed: match[2], detail: match[3] || "", attention: /^(?:stalled|waiting|recovered; waiting)/.test(match[3] || "") };
  });
  return lines.every(Boolean) ? lines : undefined;
}
function supported(message: any): boolean {
  if (message?.customType === "subagent_status") return !!statusLines(message);
  const d = message?.details;
  if (!["subagent_result", "subagent_question"].includes(message?.customType) || typeof message.content !== "string" ||
    !d || Array.isArray(d) || typeof d.name !== "string" || !d.name.trim() || !recordedJSON(message)) return false;
  if (message.customType === "subagent_question") return typeof d.question === "string" && !!d.question.trim();
  return (d.exitCode === undefined || Number.isInteger(d.exitCode)) &&
    (d.errorMessage === undefined || typeof d.errorMessage === "string") &&
    (d.error === undefined || typeof d.error === "string") &&
    // Running/waiting/action payloads are not completed child reports.
    (d.status === undefined || ["completed", "success", "failed", "error", "cancelled", "canceled"].includes(d.status)) &&
    !["question", "pendingQuestion", "requiresAction", "actionRequired", "userActionRequest"].some(key => key in d);
}
function summary(message: any) {
  const d = message.details;
  if (message.customType === "subagent_status") {
    const lines = statusLines(message)!;
    const line = lines.find(line => line.attention) || lines[0];
    const detail = line.detail ? line.detail[0].toUpperCase() + line.detail.slice(1) : "";
    return { color: line.attention ? "warning" : "muted", icon: line.attention ? "⚠" : "…", name: clean(line.name), failed: false, pending: true,
      title: `Status · ${clean(line.name)} · ${line.attention ? "⚠ " : ""}${detail ? detail + " · " : ""}Running ${line.elapsed}${lines.length > 1 ? ` · +${lines.length - 1} other statuses` : ""}${d.overflow ? ` · +${d.overflow} more running` : ""}` };
  }
  if (message.customType === "subagent_question") return { color: "accent", icon: "?", name: clean(d.name), failed: false, pending: true,
    title: `? Question · ${truncateToWidth(clean(d.name), 32, "…")}` };
  const error = d.errorMessage?.trim() || d.error?.trim() || "";
  // Match the exact native cancellation summary without splitting a full report.
  const cancellation = `Sub-agent "${d.name}" failed (exit code ${d.exitCode}).\n\nSubagent cancelled.`;
  const nativeCancelled = typeof d.exitCode === "number" && d.exitCode !== 0 &&
    (message.content === cancellation || message.content.startsWith(cancellation + "\n\n"));
  const cancelled = ["cancelled", "canceled"].includes(d.status) || /^(?:cancelled|canceled)$/i.test(error) || nativeCancelled;
  const failed = !!error || (typeof d.exitCode === "number" && d.exitCode !== 0) || ["failed", "error"].includes(d.status);
  const success = d.exitCode === 0 || ["completed", "success"].includes(d.status);
  const status = cancelled ? "⊘ Cancelled" : failed ? "✗ Failed" : success ? "✓ Subagent completed" : "? Result (status unknown)";
  const color = failed || cancelled ? "error" : success ? "success" : "warning";
  const elapsed = typeof d.elapsed === "number" && Number.isFinite(d.elapsed) && d.elapsed >= 0 ? `${d.elapsed}s` : "elapsed unknown";
  const reason = error || (nativeCancelled ? "Subagent cancelled." : failed && d.exitCode !== undefined ? `exit ${d.exitCode}` : "");
  return { color, icon: status.slice(0, 1), name: clean(d.name), failed: failed || cancelled, pending: false, title: `${status} · ${truncateToWidth(clean(d.name), 32, "…")}${reason ? ` · ${truncateToWidth(clean(reason), 180, "…")}` : ""} · ${elapsed}` };
}

// No public next-message-renderer resolver exists in Pi 1.1.0; first registration
// wins. Adapt only the exported custom-message surface, not the runner or root.
export function installSubagentCards(getMode: () => string, active = () => true, version = VERSION, controls: ReportControls = {}) {
  if (version !== "1.1.0") return undefined;
  const proto = CustomMessageComponent.prototype as any;
  if (typeof proto.rebuild !== "function" || typeof proto.render !== "function" || typeof proto.setExpanded !== "function") return undefined;
  proto[ownerKey]?.dispose?.();
  const originalRebuild = proto.rebuild;
  const originalRender = proto.render;
  const renderDescriptor = Object.getOwnPropertyDescriptor(proto, "render");
  let disposed = false;
  const enabled = () => !disposed && active() && ["quiet", "compact", "expanded"].includes(getMode());
  const shape = (instance: any) => Array.isArray(instance.children) && "customComponent" in instance &&
    typeof instance._expanded === "boolean" && Number.isFinite(instance.outputPad) && instance.box &&
    typeof instance.customRenderer === "function";
  const rebuild = function(this: any) {
    delete this[cardKey];
    if (!enabled() || !shape(this) || !supported(this.message) || this.message.customType === "subagent_status" && getMode() !== "quiet") { delete this[paneKey]; return originalRebuild.call(this); }
    const nativeRenderer = this.customRenderer;
    const shell = this;
    const mode = getMode();
    this.customRenderer = (message: any, options: any, theme: any) => {
      const native = nativeRenderer(message, options, theme);
      if (!native || typeof native.render !== "function") return native;
      const info = summary(message);
      // InteractiveMode already applies the global display preset with public
      // setExpanded(). Its flag must remain authoritative after mouse/Ctrl+O.
      const excerpt = message.customType === "subagent_status" ? "" : reportExcerpt(message);
      const style = controls.style || (() => ({ frame: true, bodyHighlight: true }));
      const redraw = controls.redraw || (() => {});
      // One local owned record survives native expansion/outputPad/invalidation
      // rebuilds. No registry or transcript lookup; stale owners fail closed.
      let record = shell[paneKey];
      if (!record || record.owner !== control || record.message !== message) {
        const report = readableReport(message);
        record = { owner: control, message, info, content: message.content, palette: theme.colors ?? theme, pad: options.outputPad, revision: 0,
          markdown: new Markdown(report, 0, 0, shell.markdownTheme), markdownTheme: shell.markdownTheme, theme };
        const target: ReportTarget = {
          valid: () => enabled() && shape(shell) && supported(shell.message) && shell.message === message && shell[paneKey] === record,
          state: () => ({ kind: "report", label: `${message.customType === "subagent_question" ? "Question" : message.customType === "subagent_status" ? "Status" : "Report"} · ${info.name}`, available: target.valid(), open: !!shell._expanded, raw: record.pane.raw, scrollable: getMode() !== "expanded", actions: [] }),
          action: action => {
            if (!target.valid()) return false;
            if (action === "refresh") { redraw(); return true; }
            if (action === "open" || action === "close") { shell.setExpanded(action === "open"); redraw(); return true; }
            if (!shell._expanded || !["raw", "up", "down", "page-up", "page-down", "home", "end"].includes(action)) return false;
            if (action !== "raw" && getMode() === "expanded") return false;
            record.pane.action(action); redraw(); return true;
          },
        };
        record.target = target;
        record.pane = new GroupPane(() => record.theme.fg(record.info.color, record.info.title), (width, raw) => {
          const pad = Math.min(Math.max(0, Math.floor(record.pad)), Math.floor((width - 1) / 2));
          const inner = Math.max(1, width - pad * 2);
          const rows = raw ? rawReportRows(message, inner, record.theme) : record.markdown.render(inner);
          if (!rows.length) rows.push(record.theme.fg("muted", "No report text was recorded."));
          return rows.map((line: string) => {
            const padded = truncateToWidth(" ".repeat(pad) + line + " ".repeat(pad), width, "");
            return style().bodyHighlight ? fillBackground(padded, width, record.theme, record.info.failed ? "toolErrorBg" : record.info.pending ? "toolPendingBg" : "toolSuccessBg") : padded;
          });
        }, controls.height || (() => paneBodyHeight("auto")), () => record.theme, () => {}, () => record.revision, style);
        record.pane.footerControls = (width: number) => {
          const view = record.pane.raw ? "[Readable]" : "[Raw]";
          if (width >= 55) return [["[↑]", "up"], ["[↓]", "down"], ["[Pg↑]", "page-up"], ["[Pg↓]", "page-down"], [view, "raw"], ["[Close]", "close"], ...(controls.onControl ? [["[Options]", "menu"]] : [])];
          if (width >= 28) return [[view, "raw"], ["[Close]", "close"], ...(controls.onControl ? [["[Options]", "menu"]] : [])];
          if (width >= 12) return [["[R]", "raw"], ["[×]", "close"], ...(controls.onControl ? [["[⋯]", "menu"]] : [])];
          return [["R", "raw"], ["×", "close"]];
        };
        record.pane.onControl = (action: string) => {
          if (!target.valid()) return;
          controls.onInteract?.(target);
          if (action === "menu") controls.onControl?.("menu");
          else target.action(action);
        };
        shell[paneKey] = record;
      }
      record.theme = theme; record.info = info;
      if (record.pad !== options.outputPad) { record.pad = options.outputPad; record.revision++; }
      if (record.content !== message.content || record.markdownTheme !== shell.markdownTheme) {
        record.content = message.content; record.markdownTheme = shell.markdownTheme;
        record.markdown = new Markdown(readableReport(message), 0, 0, shell.markdownTheme); record.revision++;
      }
      const refreshPalette = () => {
        if (record.palette !== (record.theme.colors ?? record.theme)) {
          record.palette = record.theme.colors ?? record.theme; record.markdown.invalidate(); record.revision++;
        }
      };
      let footerY = -1;
      let cacheWidth: number | undefined, cacheRaw: boolean | undefined, cache: string[] | undefined;
      const component = {
        render(width: number): string[] {
          // Existing cards restore themselves after shutdown/unsupported mode,
          // without retaining a component registry or visiting the transcript.
          if (!enabled() || getMode() !== mode) {
            if (!enabled() && shell[paneKey] === record) delete shell[paneKey];
            shell.rebuild();
            const replacement = shell.customComponent || shell.box;
            return replacement === component ? [] : replacement.render(width);
          }
          refreshPalette();
          width = Math.max(1, Math.floor(width));
          const expanded = shell._expanded;
          // Quiet summaries share GroupPane/thinking's disclosure column. Keep
          // native outputPad for all expanded bodies and other display modes.
          const pad = mode === "quiet" && !expanded ? 0 : Math.min(Math.max(0, Math.floor(options.outputPad)), Math.floor((width - 1) / 2));
          const inner = Math.max(1, width - pad * 2);
          if (expanded && mode !== "expanded") {
            const rows = record.pane.render(width, true);
            footerY = rows.length - 1;
            return rows;
          }
          footerY = -1;
          const disclosure = expanded ? "▾" : "▸";
          const title = mode === "quiet" ? info.title.replace(/^\? Question/, "Child question").replace(/^✓ Subagent completed/, "Subagent completed ✓").replace(/^✗ Failed/, "Failed ✗").replace(/^⊘ Cancelled/, "Cancelled ⊘") : info.title;
          const header = mode === "quiet" && inner <= 2 && info.failed ? `${disclosure}${info.icon}` : mode !== "quiet" && inner < 8 ? `${disclosure}${info.icon}${info.name}` :
            `${disclosure} ${title}${!expanded && mode !== "compact" && !info.failed && excerpt ? ` · ${excerpt}` : ""}`;
          let lines = [theme.fg(info.color, truncateToWidth(header, inner, inner < 8 ? "" : "…"))];
          if (expanded) {
            if (cacheWidth !== inner || cacheRaw !== record.pane.raw || !cache) {
              // Literal wrapped view deliberately preserves original Markdown
              // source, follow-up text and every recorded metadata field. Amos's
              // expanded view strips source and slices long lines instead.
              cache = record.pane.raw ? rawReportRows(message, inner, theme) : record.markdown.render(inner);
              cacheWidth = inner; cacheRaw = record.pane.raw;
            }
            lines.push(...cache.map(line => theme.fg("toolOutput", line)));
          } else if (mode === "compact") {
            if (excerpt && !info.failed) lines.push(theme.fg("muted", truncateToWidth(excerpt, inner, "…")));
          }
          return lines.map(line => {
            const padded = truncateToWidth(" ".repeat(pad) + line, width, "");
            if (mode === "quiet" && !expanded && !info.failed) return padded;
            return style().bodyHighlight || !expanded ? fillBackground(padded, width, theme, info.failed ? "toolErrorBg" : info.pending ? "toolPendingBg" : "toolSuccessBg") : padded;
          });
        },
        handleMouse(event: any) {
          // Container translates past the native separator. Only the actual
          // header owns left clicks; body selection/drag/wheel remain native.
          if (!record.target.valid() || shell.customComponent !== component || event.x < 0 || event.x >= event.width) return undefined;
          if (event.type === "click" && event.button === "left" && event.y === 0) {
            controls.onInteract?.(record.target);
            shell.setExpanded(!shell._expanded);
            return { handled: true, render: true };
          }
          if (shell._expanded && mode !== "expanded" && (event.type === "wheel" || event.type === "click" && event.button === "left" && event.y === footerY)) {
            controls.onInteract?.(record.target);
            const result = record.pane.handleMouse(event, true);
            return result ? { ...result, render: true } : undefined;
          }
          return undefined;
        },
        invalidate() { cacheWidth = undefined; cache = undefined; },
      };
      this[cardKey] = mode;
      return component;
    };
    try { return originalRebuild.call(this); }
    finally { this.customRenderer = nativeRenderer; }
  };
  const render = function(this: any, width: number) {
    if (this[cardKey] !== undefined && (!enabled() || this[cardKey] !== getMode())) this.rebuild();
    return originalRender.call(this, width);
  };
  const control = {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (proto.rebuild === rebuild) proto.rebuild = originalRebuild;
      if (proto.render === render) {
        if (renderDescriptor) Object.defineProperty(proto, "render", renderDescriptor);
        else delete proto.render;
      }
      if (proto[ownerKey] === control) delete proto[ownerKey];
    },
  };
  proto.rebuild = rebuild;
  proto.render = render;
  proto[ownerKey] = control;
  return control;
}

export default function registerSubagentCards(pi: ExtensionAPI, getMode: () => string, controls: ReportControls & { onReset?: () => void } = {}) {
  let control: ReturnType<typeof installSubagentCards>;
  let epoch = 0;
  pi.on("session_start", (_event, ctx) => {
    control?.dispose();
    control = undefined;
    controls.onReset?.();
    const ownEpoch = ++epoch;
    // Mouse handlers return render:true. Commands use the public footer-status
    // invalidation path with an empty owned key: request paint, no visible status
    // or full-history/expansion rebuild. Never touch another extension's key.
    // Retained lazy surfaces can paint after runner revocation, even before
    // teardown. Capture host UI data while valid; epoch/disposal still owns actions.
    const mode = ctx.mode;
    if (mode === "tui") {
      const ui = ctx.ui;
      control = installSubagentCards(getMode, () => mode === "tui" && epoch === ownEpoch, VERSION,
        { ...controls, redraw: controls.redraw || (() => ui.setStatus?.("compact-tool-renderers/details-redraw", undefined)) });
    }
  });
  for (const event of ["session_switch", "session_tree", "session_compact"] as const) pi.on(event, () => { controls.onReset?.(); });
  pi.on("session_shutdown", () => { ++epoch; controls.onReset?.(); control?.dispose(); control = undefined; });
}
