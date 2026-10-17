import { Text, truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { NativeToolOwner, nativeToolsSupported, nativeToolContextSupported, nativeTextFallback } from "./modern-native-tools.ts";
import { ToolPane, type PaneAction } from "./modern-tool-pane.ts";

type Mode = { isEnabled(): boolean; onChange(callback: () => void): () => void };
type Context = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Status = "pending" | "running" | "success" | "failed" | "cancelled" | "unavailable" | "unanswered" | "answered" | "notice";
type Node = { id: string; name: string; args: any; epoch: number; status: Status; result?: any; note?: string; pane?: ToolPane; group?: Group; native: NativeToolOwner; invalidate?: () => void; nativeExpanded?: boolean; rendererAttached?: boolean; revision: number };
type Group = { members: Node[]; pane: ToolPane; signature: string };
const shortName = (name: string) => name.split("__").at(-1) || name;
export const isNativeSubagent = (name: string) => /^(?:subagents?(?:_|$)|fleet(?:_|$))/i.test(shortName(name));
const clean = (value: unknown) => String(value ?? "").slice(0, 240).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim();
const question = (name: string) => shortName(name) === "ask_user_question";
const json = (value: any) => { try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return "[value could not be serialized]"; } };
export function toolStatus(name: string, result: any, partial = false, error = false): { status: Status; note?: string } {
  if (error || result?.isError) return { status: "failed" };
  if (partial) return { status: "running" };
  const details = result?.details;
  if (question(name)) {
    if (error || result?.isError) return { status: "failed" };
    const status = details?.status;
    if (status === "answered") return { status: Array.isArray(details.answers) && details.answers.length ? "answered" : "unanswered" };
    if (["cancelled", "unavailable"].includes(status)) return { status };
    return { status: "unanswered" };
  }
  if (error || result?.isError) return { status: "failed" };
  if (["bash", "powershell"].includes(name) && typeof details?.exitCode === "number" && details.exitCode !== 0) return { status: "failed" };
  if (name === "codemode" && Array.isArray(details?.calls)) {
    if (details.calls.some((call: any) => ["error", "failed"].includes(call.status))) return { status: "failed" };
    if (details.calls.some((call: any) => call.status === "cancelled")) return { status: "cancelled" };
    if (details.calls.some((call: any) => ["started", "running", "unavailable"].includes(call.status))) return { status: "notice", note: "Nested action remains unresolved" };
  }
  // Unknown tools own their status contracts. A recorded non-success status is visible, never ✓ Completed.
  if (typeof details?.status === "string" && !["success", "ok", "completed"].includes(details.status)) return { status: "notice", note: `Recorded status: ${clean(details.status)}` };
  return { status: "success" };
}
export function toolLabel(name: string, args: any): string {
  const short = shortName(name);
  const target = args?.path ?? args?.file_path ?? args?.url ?? args?.pattern ?? args?.query;
  if (["bash", "powershell"].includes(short)) return `${short} · ${clean(args?.command) || "Shell command"}`;
  return `${clean(short)}${target === undefined ? "" : ` · ${clean(target)}`}`;
}
// Walk recorded values lazily so large command/write arguments or nested output strings
// do not require full serialization before the first visible rows can paint.
function* values(value: any, label = "arguments", ancestors = new Set<object>()): Generator<string> {
  if (typeof value === "string") { yield `${label} (string)`; yield value; return; }
  if (value === null || typeof value !== "object") { yield `${label}: ${json(value)}`; return; }
  if (ancestors.has(value)) { yield `${label}: [circular reference]`; return; }
  ancestors.add(value);
  yield `${label} (${Array.isArray(value) ? "array" : "object"})`;
  let count = 0;
  for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) { count++; yield* values(value[key], `${label}.${key}`, ancestors); }
  if (!count) yield Array.isArray(value) ? "[]" : "{}";
  ancestors.delete(value);
}
function indicators(node: Node) {
  const details = node.result?.details;
  return `${details?.truncation?.truncated || details?.truncated ? " · output truncated" : ""}${details?.fullOutputPath ? " · full output saved" : ""}${details?.warning || details?.warnings?.length ? " · warning recorded" : ""}`;
}
function* sections(node: Node): Generator<string> {
  yield "Exact arguments"; yield* values(node.args);
  if (node.result) {
    yield "Recorded output";
    for (const block of node.result.content ?? []) {
      if (block.type === "text") yield String(block.text ?? "");
      else if (block.type === "image") yield `[Recorded image: ${clean(block.mimeType)}; native preview is retained outside groups]`;
      else yield* values(block, "content block");
    }
    if (node.result.details !== undefined) { yield "Recorded details"; yield* values(node.result.details, "details"); }
  }
}
function failureReason(node: Node): string {
  if (node.status !== "failed") return "";
  const details = node.result?.details;
  let reason = typeof details?.error === "string" ? details.error : typeof details?.errorMessage === "string" ? details.errorMessage : "";
  if (!reason) for (const block of node.result?.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      // Status comes from structured failure signals. This is a recorded excerpt, never error detection from prose.
      reason = block.text.slice(0, 512).trim().split(/\r?\n/, 1)[0];
      if (reason) break;
    }
  }
  if (!reason && typeof details?.exitCode === "number") reason = `exit ${details.exitCode}`;
  return clean(reason).slice(0, 120);
}
function questionTitle(node: Node): string {
  const statuses: Record<string, string> = { pending: "Pending", running: "Pending", failed: "Failed", answered: "Answered", cancelled: "Cancelled", unavailable: "Unavailable", unanswered: "Unanswered" };
  let answer = "";
  if (node.status === "answered") answer = ` · ${node.result.details.answers.map((item: any) => clean(item.label ?? item.value)).join("; ")}`;
  return `Question · ${statuses[node.status] || "Unanswered"} · ${clean(node.result?.details?.question ?? node.args?.question)}${answer}`;
}
class DynamicComponent {
  constructor(private draw: (width: number) => string[], private mouse?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined) {}
  render(width: number) { return this.draw(Math.max(1, width)); }
  handleMouse(event: TuiMouseEvent) { return this.mouse?.(event); }
  invalidate() {}
}

/** Display-only tools: public renderer/event/input APIs; no messages or tool execution are changed. */
export function registerModernTools(pi: ExtensionAPI, mode: Mode): () => void {
  if (!nativeToolsSupported) return () => {};
  let disposed = false;
  let epoch = 0;
  let nodes = new Map<string, Node>();
  let groups = new Map<string, Group>();
  let focused: ToolPane | undefined;
  let inputOff: (() => void) | undefined;
  const height = () => Math.max(4, Math.min(20, (process.stdout.rows || 24) - 10));
  let generation = 0;
  const rowGenerations = new WeakMap<object, number>();
  let rebuilding = false;
  const subscriptions: (() => void)[] = [];
  const redraw = () => {
    // Snapshot before native synchronous invalidate -> updateDisplay -> renderer registration.
    for (const invalidate of [...new Set([...nodes.values()].map(node => node.invalidate).filter(Boolean))]) invalidate!();
  };
  const release = () => { if (focused) { focused.focused = false; focused = undefined; } };
  const action = (node: Node): PaneAction => ({ id: node.id, label: toolLabel(node.name, node.args) + indicators(node), sections: () => sections(node) });
  const refreshGroups = () => {
    let run: Node[] = [];
    const next = new Map<string, Group>();
    const finish = () => {
      if (!run.length) return;
      const id = run[0].id;
      const signature = run.map(node => `${node.id}@${node.revision}`).join("|");
      let group = groups.get(id);
      if (!group) group = { members: [], signature: "", pane: new ToolPane([], "", height) };
      if (group.signature !== signature) { group.pane.actions = run.map(action); group.pane.selected = Math.min(group.pane.selected, run.length - 1); group.pane.reset(); group.signature = signature; }
      group.members = run;
      const counts = new Map<string, number>();
      for (const node of run) { const name = clean(shortName(node.name)); counts.set(name, (counts.get(name) || 0) + 1); }
      const kinds = [...counts].slice(0, 3).map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ""}`).join(", ");
      group.pane.title = `✓ ${run.length} successful action${run.length === 1 ? "" : "s"} · ${run.length === 1 ? toolLabel(run[0].name, run[0].args) : kinds}${counts.size > 3 ? ` +${counts.size - 3} types` : ""}`;
      if (run.some(node => node.result?.details?.truncation?.truncated || node.result?.details?.truncated)) group.pane.title += " · output truncated";
      if (run.some(node => node.result?.details?.fullOutputPath)) group.pane.title += " · full output saved";
      if (run.some(node => node.result?.details?.warning || node.result?.details?.warnings?.length)) group.pane.title += " · warning recorded";
      for (const node of run) node.group = group;
      next.set(id, group); run = [];
    };
    for (const node of nodes.values()) {
      node.group = undefined;
      if (node.status !== "success" || node.result?.content?.some((block: any) => block.type === "image")) { finish(); continue; }
      if (run.length && node.epoch !== run[0].epoch) finish();
      run.push(node);
    }
    finish(); groups = next;
    if (focused && ![...groups.values()].some(group => group.pane === focused) && ![...nodes.values()].some(node => !node.group && node.pane === focused)) release();
  };
  const ensure = (id: string, name: string, args?: any, stock?: ToolRenderers) => {
    let node = nodes.get(id);
    if (!node) { node = { id, name, args, epoch, status: "pending", revision: 0, native: new NativeToolOwner(name, stock) }; nodes.set(id, node); }
    if (args !== undefined && node.args !== args) { node.args = args; node.revision++; node.pane?.reset(); }
    return node;
  };
  const record = (node: Node, result: any, partial: boolean, error: boolean) => {
    const next = toolStatus(node.name, result, partial, error);
    const changed = node.result?.content !== result?.content || node.result?.details !== result?.details || node.status !== next.status || node.note !== next.note;
    node.result = result; node.note = next.note; node.status = next.status;
    if (!changed) return;
    node.revision++; node.pane?.reset();
    if (!rebuilding) refreshGroups();
  };
  const observeMessage = (message: any) => {
    if (message?.role === "assistant") {
      if (message.errorMessage || message.content?.some((block: any) => block.type === "text" && block.text?.trim())) epoch++;
      for (const call of message.content ?? []) if (call.type === "toolCall") {
        if (isNativeSubagent(call.name)) { epoch++; continue; }
        if (question(call.name)) epoch++;
        ensure(call.id, call.name, call.arguments);
        if (question(call.name)) epoch++;
      }
    } else if (message?.role === "toolResult") {
      if (isNativeSubagent(message.toolName || "")) { epoch++; return; }
      const node = ensure(message.toolCallId, message.toolName || "tool");
      record(node, message, false, !!message.isError);
      if (node.status !== "success") epoch++;
    } else if (message?.role !== "system" && !(message?.role === "custom" && message.display === false)) epoch++;
  };
  const clear = () => {
    release(); inputOff?.(); inputOff = undefined;
    for (const node of nodes.values()) node.native.dispose();
    nodes = new Map(); groups = new Map(); epoch = 0; generation++;
  };
  const attach = (_event: any, ctx: any) => {
    clear();
    rebuilding = true;
    try { for (const entry of ctx.sessionManager?.buildContextEntries?.() ?? ctx.sessionManager?.getBranch?.() ?? []) {
      if (entry.type === "message") observeMessage(entry.message);
      else if (["compaction", "branch_summary"].includes(entry.type) || (entry.type === "custom_message" && entry.display !== false)) epoch++;
    } } finally { rebuilding = false; }
    refreshGroups();
    if (ctx.hasUI && typeof ctx.ui?.onTerminalInput === "function") inputOff = ctx.ui.onTerminalInput((data: string) => {
      if (disposed || !mode.isEnabled()) return;
      if (data === "\u001bg") {
        const panes = [...nodes.values()].flatMap(node => node.group ? node.group.members[0] === node ? [node.group.pane] : [] : node.pane ? [node.pane] : []);
        if (!panes.length) return;
        const next = (panes.indexOf(focused!) + 1) % panes.length;
        release(); focused = panes[next]; focused.focused = true; focused.open = true;
        pi.events.emit("compact-renderer:focus:v1", { owner: "tools" }); redraw(); return { consume: true };
      }
      if (!focused) return;
      if (data === "\u001b") { release(); redraw(); return { consume: true }; }
      if (focused.handle(data)) { redraw(); return { consume: true }; }
    });
  };
  const on = (event: string, callback: any) => { const off = (pi.on as any)(event, callback); if (typeof off === "function") subscriptions.push(off); };
  for (const event of ["session_start", "session_tree", "session_compact"]) on(event, attach);
  on("session_before_switch", clear);
  on("session_shutdown", clear);
  on("ui_prompt_start", () => { release(); redraw(); });
  on("message_end", (event: any) => { if (!disposed && !rebuilding) { observeMessage(event.message); refreshGroups(); redraw(); } });
  on("tool_execution_start", (event: any) => {
    if (event.parentToolCallId) return;
    if (isNativeSubagent(event.toolName)) { epoch++; return; }
    if (question(event.toolName)) epoch++;
    const node = ensure(event.toolCallId, event.toolName, event.args); node.status = "running";
    if (question(event.toolName)) epoch++;
    refreshGroups();
  });
  on("tool_execution_end", (event: any) => {
    if (event.parentToolCallId || isNativeSubagent(event.toolName)) return;
    const node = ensure(event.toolCallId, event.toolName);
    record(node, event.result, false, !!event.isError); node.native.suspend();
    if (node.status !== "success") epoch++;
    redraw();
  });
  const focusOff = pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "tools") { release(); redraw(); } });
  if (typeof focusOff === "function") subscriptions.push(focusOff);
  subscriptions.push(mode.onChange(() => { release(); for (const node of nodes.values()) node.native.suspend(); redraw(); }));
  pi.registerToolRenderer((name, next) => {
    const stock = next();
    if (isNativeSubagent(name)) return stock;
    const stale = (context: Context) => {
      if (!context.state || typeof context.state !== "object") return false;
      const previous = rowGenerations.get(context.state);
      if (previous === undefined) rowGenerations.set(context.state, generation);
      return previous !== undefined && previous !== generation;
    };
    const get = (args: any, context: Context) => {
      const node = ensure(context.toolCallId, name, args, stock);
      // History events may create a node before its renderer definition is available.
      if (!node.rendererAttached) { node.native.dispose(); node.native = new NativeToolOwner(name, stock); node.rendererAttached = true; }
      node.invalidate = context.invalidate;
      return node;
    };
    const singleCard = (node: Node) => question(name) || !!node.result && !["pending", "running", "success"].includes(node.status);
    const individual = (node: Node, theme?: any) => {
      node.pane ||= new ToolPane([action(node)], "", height);
      node.pane.title = question(name) ? questionTitle(node) : `${node.status === "failed" ? "✗" : node.status === "success" ? "✓" : "…"} ${toolLabel(name, node.args)} · ${node.note || node.status}${indicators(node)}`;
      const reason = failureReason(node);
      if (reason) node.pane.title += ` · ${reason}`;
      if (theme) node.pane.styleHeader = node.status === "failed" ? text => theme.fg("error", text) : text => text;
      return node.pane;
    };
    const mouse = (pane: ToolPane | undefined, event: TuiMouseEvent) => {
      if (!pane || disposed || !mode.isEnabled()) return undefined;
      const result = pane.handleMouse(event);
      if (result?.handled && result.render !== false) {
        release(); focused = pane; pane.focused = true;
        pi.events.emit("compact-renderer:focus:v1", { owner: "tools" }); redraw();
      }
      // Native MouseRegion otherwise toggles the entire row for an out-of-bounds left click.
      if (!result && event.type === "click" && event.button === "left") return { handled: true, render: false };
      return result;
    };
    const syncExpansion = (node: Node, expanded: boolean) => {
      if ((node.nativeExpanded !== undefined && node.nativeExpanded !== expanded) || (node.nativeExpanded === undefined && expanded)) (node.group?.pane || individual(node)).open = expanded;
      node.nativeExpanded = expanded;
    };
    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        if (disposed || !nativeToolContextSupported(context) || stale(context)) return stock?.renderCall?.(args, theme, { ...context, executionStarted: false, state: {}, lastComponent: undefined }) ?? new Text(json(args), 0, 0);
        const node = get(args, context);
        if (disposed || !mode.isEnabled()) return node.native.renderCall(args, theme, context);
        node.native.suspend(); syncExpansion(node, context.expanded);
        return new DynamicComponent(width => {
          if (node.group) return [];
          if (singleCard(node)) return individual(node, theme).render(width);
          return [truncateToWidth(theme.fg("toolTitle", `${node.result ? "" : "… "}${toolLabel(name, node.args)}${node.result ? "" : ` · ${context.executionStarted ? "running" : "preparing"}`}`), width)];
        }, event => mouse(!node.group && singleCard(node) ? individual(node, theme) : undefined, event));
      },
      renderResult(result, options, theme, context) {
        if (disposed || !nativeToolContextSupported(context) || stale(context)) return stock?.renderResult?.(result, options, theme, { ...context, executionStarted: false, state: {}, lastComponent: undefined }) ?? nativeTextFallback(result, theme);
        const node = get(context.args, context); record(node, result, options.isPartial, context.isError);
        if (disposed || !mode.isEnabled()) return node.native.renderResult(result, options, theme, context);
        node.native.suspend(); syncExpansion(node, context.expanded);
        return new DynamicComponent(width => {
          if (node.group) { const group = node.group; if (group.members[0] !== node) return []; return group.pane.render(width); }
          if (singleCard(node)) return [];
          return individual(node, theme).render(width);
        }, event => mouse(node.group ? node.group.members[0] === node ? node.group.pane : undefined : !singleCard(node) ? individual(node, theme) : undefined, event));
      },
    };
  });
  return () => { if (disposed) return; disposed = true; clear(); for (const off of subscriptions.splice(0)) off(); };
}
