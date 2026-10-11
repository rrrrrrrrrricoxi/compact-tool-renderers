import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, mixColors, colorToRgb, rgbColor, type Component } from "@earendil-works/pi-tui";
import { wrapRecordedLine, type ReportTarget } from "./subagent-cards.ts";
import type { QuietGroups } from "./quiet-tools.ts";

type Answer = { type: "text" | "other" | "option"; label: string; value: string; index?: number };
/** Fail closed: only the named tool's own persisted details and current call args.
 * No content parsing, nested result inference, cross-call lookup or approval semantics. */
export function answeredDetails(details: any, args: any): details is { question: string; mode: string; answers: Answer[] } {
  if (!details || details.status !== "answered" || typeof details.question !== "string" || details.question !== args?.question
    || (details.context !== undefined && typeof details.context !== "string")
    || (details.message !== undefined && typeof details.message !== "string") || !Array.isArray(details.answers)) return false;
  if (args.options !== undefined && (!Array.isArray(args.options) || args.options.some((o: any) => !o || typeof o.label !== "string" || (o.value !== undefined && typeof o.value !== "string")))) return false;
  const options = (args.options || []).filter((o: any) => o.label.trim()).map((o: any) => ({ label: o.label.trim(), value: o.value?.trim() || o.label.trim() }));
  const mode = !options.length ? "text" : args.multiSelect ? "multi-select" : "single-select";
  if (details.mode !== mode || !details.answers.length || (mode !== "multi-select" && details.answers.length !== 1)) return false;
  const indices = new Set<number>();
  let other = false;
  return details.answers.every((a: any) => {
    if (!a || typeof a.label !== "string" || typeof a.value !== "string") return false;
    if (mode === "text") return a.type === "text" && a.label === a.value;
    if (a.type === "other") { if (other || !a.label.trim() || a.label !== a.value) return false; other = true; return true; }
    if (a.type !== "option" || !Number.isInteger(a.index) || indices.has(a.index)) return false;
    indices.add(a.index);
    const option = options[a.index - 1];
    return !!option && a.label === option.label && a.value === option.value;
  });
}

// Literal terminal-safe rendering preserves whitespace and escapes control bytes.
// Collapsed work is bounded in both source characters and rendered rows.
function literal(text: string, heading: string, expanded: boolean, pad: number, theme: any, limit = 4, color = "accent", notice = "… Ctrl+O for full original answer"): Component {
  return {
    render(width) {
      const padding = Math.min(Math.max(0, pad || 0), Math.floor(Math.max(0, width - 1) / 2));
      const available = Math.max(1, width - padding * 2);
      const rail = available >= 3 ? "│ " : available === 2 ? "│" : "";
      const inner = Math.max(1, available - rail.length);
      const source = expanded ? text : text.slice(0, 2048);
      const rows: string[] = [];
      let clipped = source.length !== text.length;
      outer: for (const line of source.split("\n")) {
        for (const row of wrapRecordedLine(line, inner)) {
          if (!expanded && rows.length === limit) { clipped = true; break outer; }
          rows.push(row);
        }
      }
      const output = [theme.fg(color, theme.bold(truncateToWidth(heading, inner, "…"))), ...rows.map(row => theme.fg("text", row))];
      if (clipped) output.push(theme.fg("muted", truncateToWidth(notice, inner, "…")));
      const base = theme.colors ? colorToRgb(theme.colors.toolSuccessBg) : undefined;
      const gray = base ? Math.round(base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722) : 0;
      const background = base && typeof theme.style === "function" ? mixColors(rgbColor(gray, gray, gray), theme.colors[color] || theme.colors.accent, heading.startsWith("Your answer") ? 0.07 : 0.035) : undefined;
      return output.map(row => {
        const line = theme.fg(color, rail) + row + " ".repeat(Math.max(0, available - rail.length - visibleWidth(row)));
        return " ".repeat(padding) + (background ? theme.style(line, { bg: background }) : line);
      });
    },
    invalidate() {},
  };
}

export function humanAnswerRenderer(_stock: ToolRenderers | undefined, controls?: { groups: QuietGroups; onInteract: (target: ReportTarget) => void }): ToolRenderers {
  const record = (context: any) => {
    const state = context.state ||= {};
    const saved = state.humanReading ||= { raw: false };
    saved.expanded = context.expanded; saved.invalidate = context.invalidate;
    const node = controls?.groups.info(context.toolCallId);
    const owner = controls ? node : state;
    if ((!controls || node?.invoked && node.name === "ask_user_question") && saved.node !== owner) {
      saved.node = owner;
      const target: ReportTarget = {
        valid: () => (!controls || controls.groups.info(context.toolCallId) === node) && saved.node === owner,
        state: () => ({ kind: "report", label: "Question · Human answer", available: target.valid(), open: !!saved.expanded, raw: !!saved.raw, scrollable: false, actions: [] }),
        action: action => {
          if (!target.valid()) return false;
          if (action === "refresh") { saved.invalidate?.(); return true; }
          if (action !== "raw" || !saved.expanded) return false;
          saved.raw = !saved.raw; saved.invalidate?.(); return true;
        },
      };
      saved.target = target; if (node) node.humanTarget = target;
    }
    return saved;
  };
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const saved = record(context);
      const options = Array.isArray(args?.options) ? args.options.filter((o: any) => o && typeof o.label === "string" && o.label.trim()) : [];
      const readable = typeof args?.question === "string" ? args.question + (context.expanded && typeof args.details === "string" && args.details ? `\n\nContext:\n${args.details}` : "") + (context.expanded && options.length ? `\n\nOptions${args.multiSelect ? " (multiple selections)" : ""}:\n` + options.map((o: any, i: number) => `${i + 1}. ${o.label.trim()}${typeof o.description === "string" && o.description.trim() ? `\n   ${o.description.trim()}` : ""}`).join("\n") : "") : "Question arguments are incomplete or unsupported.";
      const body = literal(saved.raw && context.expanded ? JSON.stringify(args ?? {}, null, 2) : readable,
        saved.raw && context.expanded ? "Original arguments (JSON)" : "Question", context.expanded, context.outputPad, theme, 2, "accent", "… Ctrl+O for full question");
      let footer = -1, buttonStart = 0, buttonEnd = 0;
      return {
        render(width) {
          const rows = body.render(width);
          footer = -1;
          if (context.expanded && saved.target?.valid()) {
            const label = saved.raw ? "[Readable]" : "[Raw]";
            const pad = Math.min(Math.max(0, context.outputPad || 0), Math.floor(Math.max(0, width - 1) / 2));
            footer = rows.length; buttonStart = pad; buttonEnd = Math.min(width, pad + label.length);
            rows.push(" ".repeat(pad) + theme.fg("muted", truncateToWidth(label + " · /blocks raw latest-question", Math.max(1, width - pad), "…")));
          }
          return rows;
        },
        handleMouse(event: any) {
          if (!saved.target?.valid()) return undefined;
          if (event.type === "click" && event.button === "left") {
            controls?.onInteract(saved.target);
            if (event.y === footer && event.x >= buttonStart && event.x < buttonEnd) { saved.target.action("raw"); return { handled: true, render: true }; }
          }
          return undefined;
        },
        invalidate() { body.invalidate(); },
      };
    },
    renderResult(result, options, theme, context) {
      const saved = record({ ...context, expanded: options.expanded });
      const error = context.isError || (result as any).isError;
      if (options.expanded && saved.raw) {
        const status = result.details?.status;
        const heading = error ? "✗ Question failed · Raw recorded result" : status === "cancelled" ? "⊘ Question cancelled · Raw recorded result" : status === "unavailable" ? "Question unavailable · Raw recorded result" : options.isPartial ? "… Question pending · Raw recorded result" : "Raw recorded result";
        const color = error ? "error" : options.isPartial || status === "cancelled" || status === "unavailable" ? "warning" : "muted";
        return literal("Original tool content (JSON):\n" + JSON.stringify(result.content ?? null, null, 2) + "\n\nRecorded details (JSON):\n" + JSON.stringify(result.details ?? null, null, 2), heading, true, context.outputPad, theme, 4, color);
      }
      if (options.isPartial || error || !answeredDetails(result.details, context.args)) {
        // The registered formatter assumes answers.map and ignores error/partial
        // flags. Do not call it when its preconditions are unmet. Paint recorded
        // text literally instead; an error/pending flag always wins over details.
        const status = result.details?.status;
        const heading = error ? "✗ Question failed" : status === "cancelled" ? "⊘ Question cancelled" : status === "unavailable" ? "Question unavailable" : options.isPartial ? "… Question pending" : "Question result · Recorded output";
        const color = error ? "error" : options.isPartial || status === "cancelled" || status === "unavailable" ? "warning" : "muted";
        const text = (Array.isArray(result.content) ? result.content : []).filter(c => c?.type === "text" && typeof c.text === "string").map(c => c.text).join("\n");
        return literal(text, heading, options.expanded, context.outputPad, theme, 4, color, "… Ctrl+O for full recorded result");
      }
      const details = result.details;
      const heading = details.mode === "multi-select" ? "Your answer · Multiple selections" : details.answers[0].type === "option" ? "Your answer · Selected option" : details.answers[0].type === "other" ? "Your answer · Custom reply" : "Your answer · Text reply";
      const text = details.answers.map(a => a.type === "option" ? `${a.index}. ${a.label}` : a.type === "other" && details.mode === "multi-select" ? `Other: ${a.label}` : a.label === "" ? "(empty submitted text — not approval)" : a.label).join("\n");
      const answer = literal(text, heading, options.expanded, context.outputPad, theme);
      return { render: width => ["", ...answer.render(width)], invalidate() { answer.invalidate(); } };
    },
  };
}
