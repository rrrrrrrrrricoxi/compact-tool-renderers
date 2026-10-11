import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { wrapRecordedLine } from "./subagent-cards.ts";

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
function literal(text: string, heading: string, expanded: boolean, pad: number, theme: any, limit = 4): Component {
  return {
    render(width) {
      const padding = Math.min(Math.max(0, pad || 0), Math.floor(Math.max(0, width - 1) / 2));
      const inner = Math.max(1, width - padding * 2);
      const source = expanded ? text : text.slice(0, 2048);
      const rows: string[] = [];
      let clipped = source.length !== text.length;
      outer: for (const line of source.split("\n")) {
        for (const row of wrapRecordedLine(line, inner)) {
          if (!expanded && rows.length === limit) { clipped = true; break outer; }
          rows.push(row);
        }
      }
      const output = [theme.fg("accent", theme.bold(truncateToWidth(heading, inner, "…"))), ...rows.map(row => theme.fg("text", row))];
      if (clipped) output.push(theme.fg("muted", truncateToWidth("… Ctrl+O for full original answer", inner, "…")));
      return output.map(row => " ".repeat(padding) + row);
    },
    invalidate() {},
  };
}

export function humanAnswerRenderer(stock: ToolRenderers | undefined): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      if (typeof args?.question !== "string") return stock?.renderCall?.(args, theme, { ...context, lastComponent: undefined }) ?? new Text("ask_user_question\n" + JSON.stringify(args ?? {}, null, 2), 0, 0);
      // Keep the question attached to this native call ID, outside ordinary groups.
      return literal(context.expanded ? args.question + "\n\nOriginal arguments (JSON):\n" + JSON.stringify(args, null, 2) : args.question,
        "Question · ask_user_question", context.expanded, context.outputPad, theme, 2);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial || context.isError || (result as any).isError || !answeredDetails(result.details, context.args)) {
        // Preserve native/registered semantics for pending, failed, cancelled,
        // unavailable and unknown shapes; never label these as a human answer.
        return stock?.renderResult?.(result, options, theme, { ...context, lastComponent: undefined })
          ?? new Text(result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), 0, 0);
      }
      const details = result.details;
      const heading = details.mode === "multi-select" ? "Your answer · Multiple selections" : details.answers[0].type === "option" ? "Your answer · Selected option" : details.answers[0].type === "other" ? "Your answer · Custom reply" : "Your answer · Text reply";
      const text = details.answers.map(a => a.type === "option" ? `${a.index}. ${a.label}` : a.type === "other" && details.mode === "multi-select" ? `Other: ${a.label}` : a.label === "" ? "(empty submitted text — not approval)" : a.label).join("\n");
      const disclosure = options.expanded ? "\n\nOriginal tool content:\n" + result.content.filter(c => c.type === "text").map(c => c.text).join("\n") + "\n\nRecorded details (JSON):\n" + JSON.stringify(result.details, null, 2) : "";
      const answer = literal(text + disclosure, heading, options.expanded, context.outputPad, theme);
      return { render: width => ["", ...answer.render(width)], invalidate() { answer.invalidate(); } };
    },
  };
}
