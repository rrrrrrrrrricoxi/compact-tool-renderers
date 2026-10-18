import { Text, truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { getLanguageFromPath, type ExtensionAPI, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { NativeToolOwner, nativeToolsSupported, nativeToolContextSupported, nativeTextFallback } from "./modern-native-tools.ts";
import { ToolPane, type PaneAction, type PaneContent } from "./modern-tool-pane.ts";
import { recordedValues } from "./modern-tool-content.ts";
import { CodePane } from "./modern-code-pane.ts";
import { cardContentWidth, activityRow } from "./display-card.ts";
import { acquireSubagentProjection, hiddenSubagent } from "./modern-subagent-groups.ts";
import { compactSubagent, subagentDecision, subagentTitle } from "./modern-subagents.ts";
import { groupIntent } from "./action-intent.ts";

type Mode = { isEnabled(): boolean; onChange(callback: () => void): () => void };
type Context = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Status = "pending" | "running" | "success" | "failed" | "cancelled" | "unavailable" | "unanswered" | "answered" | "notice";
type Node = { id: string; name: string; args: any; epoch: number; status: Status; result?: any; note?: string; pane?: ToolPane; code?: CodePane; group?: Group; native: NativeToolOwner; invalidate?: () => void; nativeExpanded?: boolean; rendererAttached?: boolean; revision: number; lastPartial?: boolean; lastError?: boolean };
type Group = { members: Node[]; pane: ToolPane; signature: string };
const shortName = (name: string) => name.split("__").at(-1) || name;
export const isNativeSubagent = (name: string) => /^(?:subagents?(?:_|$)|fleet(?:_|$))/i.test(shortName(name));
const usesNativePresentation = (name: string) => isNativeSubagent(name) && !compactSubagent(name);
const clean = (value: unknown) => String(value ?? "").slice(0, 240).replace(/[\uD800-\uDBFF]$/, "").replace(/[\x00-\x1f\x7f-\x9f]|\p{Cf}/gu, " ").trim();
const question = (name: string) => shortName(name) === "ask_user_question";
const json = (value: any) => { try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return "[value could not be serialized]"; } };
export function toolStatus(name: string, result: any, partial = false, error = false): { status: Status; note?: string } {
  if (error || result?.isError) return { status: "failed" };
  if (compactSubagent(name) && result?.details?.steering?.state === "failed") return { status: "failed" };
  if (partial) return { status: "running" };
  const details = result?.details;
  if (compactSubagent(name) && details?.steering?.state === "partial") return { status: "notice", note: "Partial steering result" };
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
    if (details.calls.some((call: any) => ["started", "running", "unavailable"].includes(call.status))) return { status: "notice", note: "Nested action remains unresolved" };
  }
  // Unknown tools own their status contracts. A recorded non-success status is visible, never ✓ Completed.
  if (typeof details?.status === "string" && !["success", "ok", "completed"].includes(details.status)) return { status: "notice", note: `Recorded status: ${clean(details.status)}` };
  return { status: "success" };
}
/** Labels describe recorded operations, never infer a script's business purpose. */
export function shellOperation(command: unknown): string {
  if (typeof command !== "string" || !command.length) return "Shell command";
  const sample = command.slice(0, 1024).trimStart();
  if (!sample) return "Shell command";
  const executable = sample.match(/^(?:(?:[A-Za-z_]\w*=(?:"[^"\n]*"|'[^'\n]*'|[^\s]+))\s+)*(?:env\s+)?(?:[\w./-]*\/)?(node(?:js)?|python[\d.]*|ruby|perl|deno|bun|bash|sh|zsh|pwsh|powershell)(?=\s|$)/i)?.[1].toLowerCase();
  const interpreter = executable && (/^node/.test(executable) ? "Node.js" : /^python/.test(executable) ? "Python" : /^(?:bash|sh|zsh)$/.test(executable) ? executable : /^(?:pwsh|powershell)$/.test(executable) ? "PowerShell" : executable[0].toUpperCase() + executable.slice(1));
  if (interpreter) {
    // Only a literal filename directly after the interpreter is reliable metadata.
    const file = sample.match(/^(?:[\w./-]*\/)?[\w.]+\s+([\w./-]+\.(?:[cm]?js|ts|py|rb|pl|sh|ps1))(?=\s|$)/)?.[1];
    const script = file || /<<|(?:^|\s)(?:-[ecp]|--eval|--print|--command)(?=\s|=|$)|(?:^|\s)-(?:\s|$)/i.test(sample);
    if (script) return `Run ${interpreter} script${file ? ` · ${clean(file).slice(0, 72)}` : ""}`;
    if (command.length <= 100 && !/[\r\n;&|]/.test(command)) return clean(command);
    return `${interpreter} command`;
  }
  if (command.length > 100 || /[\r\n]|<<|[;&|]|(?:^|\s)(?:-e|-c|--eval|--command)(?:\s|=|$)/i.test(sample)) {
    const program = sample.match(/^(?:[\w./-]*\/)?([\w.-]+)(?=\s|$)/)?.[1];
    return `Shell script${program ? ` · ${program}` : ""}`;
  }
  return clean(command);
}
export function toolLabel(name: string, args: any): string {
  const short = shortName(name);
  const target = args?.path ?? args?.file_path ?? args?.url ?? args?.pattern ?? args?.query;
  if (["bash", "powershell"].includes(short)) return `${short} · ${shellOperation(args?.command)}`;
  return `${clean(short)}${target === undefined ? "" : ` · ${clean(target).slice(0, 100)}`}`;
}
function argumentLanguages(node: Node): Record<string, string | undefined> {
  const path = node.args?.path ?? node.args?.file_path;
  const language = typeof path === "string" ? getLanguageFromPath(path) : undefined;
  return { command: shortName(node.name) === "powershell" ? "powershell" : "bash", code: "javascript", source: language,
    content: language, oldText: language, newText: language, diff: "diff" };
}

function indicators(node: Node) {
  const details = node.result?.details;
  return `${details?.truncation?.truncated || details?.truncated ? " · output truncated" : ""}${details?.fullOutputPath ? " · full output saved" : ""}${details?.warning || details?.warnings?.length ? " · warning recorded" : ""}`;
}
function matchesQuestionOption(answer: any, option: any, index: number): boolean {
  if (!answer || answer.type && answer.type !== "option") return false;
  // pi-questions records one-based indices. They disambiguate repeated labels/values.
  if (Number.isInteger(answer.index)) return answer.index === index + 1;
  if (answer.value !== undefined) return answer.value === (option?.value ?? option?.label);
  return answer.label !== undefined && answer.label === option?.label;
}
function* sections(node: Node): Generator<PaneContent> {
  if (question(node.name)) {
    const details = node.result?.details;
    yield String(details?.question ?? node.args?.question ?? "");
    const context = details?.context ?? node.args?.details;
    if (typeof context === "string" && context.trim()) yield context;
    const answers = node.status === "answered" && Array.isArray(details?.answers) ? details.answers : [];
    const matched = new Set<number>();
    if (Array.isArray(node.args?.options) && node.args.options.length) {
      let index = 0;
      for (const recordedOption of node.args.options) {
        // Match pi-questions' trim/filter normalization without reading later options eagerly.
        const label = typeof recordedOption?.label === "string" ? recordedOption.label.trim() : "";
        if (!label) continue;
        const option = { label, value: recordedOption.value?.trim() || label, description: recordedOption.description?.trim() };
        const answerIndex = answers.findIndex((answer: any, i: number) => !matched.has(i) && matchesQuestionOption(answer, option, index));
        const selected = answerIndex !== -1;
        if (selected) matched.add(answerIndex);
        const description = typeof option?.description === "string" && option.description ? ` — ${option.description}` : "";
        yield { text: `${selected ? "✓" : " "} ${index + 1}. ${String(option?.label ?? "")}${description}`, ...(selected ? { kind: "answer" as const } : {}) };
        index++;
      }
    }
    for (const [index, answer] of answers.entries()) {
      if (matched.has(index)) continue;
      const prefix = answer.type === "other" ? "Other: " : answer.type === "option" && Number.isInteger(answer.index) ? `${answer.index}. ` : "";
      yield { text: "✓ " + prefix + String(answer.label ?? answer.value ?? ""), kind: "answer" };
    }
    if (node.status !== "answered") {
      const diagnostic = (message: unknown): message is string => typeof message === "string" && !!message.trim() && message.trim() !== questionState(node) &&
        !(node.status === "cancelled" && message.trim() === "User cancelled the question");
      if (diagnostic(details?.message)) yield details.message;
      else for (const block of node.result?.content ?? []) if (block.type === "text" && diagnostic(block.text)) yield block.text;
    }
    return;
  }
  if (node.name === "write" && node.status === "success" && typeof node.args?.content === "string" && typeof node.args?.path === "string") {
    const text = node.args.content, language = getLanguageFromPath(node.args.path);
    if (text.length <= 120 && !/[\r\n\p{Cc}\p{Cf}]/u.test(text)) yield { text, label: "Content", ...(language ? { format: "code" as const, language } : {}) };
    else { yield { text: "Content", kind: "section" }; yield { text, ...(language ? { format: "code" as const, language } : {}) }; }
  }
  const failure = compactFailure(node);
  if (failure) yield `${failure.code} · ${failure.label}`;
  else if (!standardWrite(node)) yield* outputSections(node);
}
function standardWrite(node: Node): boolean {
  const path = node.args?.path;
  return node.name === "write" && node.status === "success" && typeof path === "string" && path.length <= 512 &&
    typeof node.args?.content === "string" && node.result?.content?.length === 1 && node.result.content[0].type === "text" &&
    node.result.content[0].text === `Successfully wrote to ${path}`;
}
function compactFailure(node: Node) {
  if (!["read", "write", "edit", "bash", "powershell"].includes(node.name)) return;
  const category = knownFailure(node);
  const content = node.result?.content;
  if (!category || content?.length !== 1 || content[0].type !== "text" || typeof content[0].text !== "string") return;
  // Only an explicit diagnostic prefix is collapsed; mixed/unknown output stays visible.
  if (content[0].text.slice(0, 128).trimStart().startsWith(`${category.code}:`) || content[0].text.slice(0, 128).trimStart().startsWith(`Error: ${category.code}:`)) return category;
}
function* outputSections(node: Node): Generator<PaneContent> {
  for (const block of node.result?.content ?? []) {
    if (block.type === "text") {
      const path = node.args?.path ?? node.args?.file_path;
      const language = node.name === "read" && node.status !== "failed" && typeof path === "string" ? getLanguageFromPath(path) : undefined;
      const markdown = language === "markdown" || block.mimeType === "text/markdown";
      yield { text: String(block.text ?? ""), ...(markdown ? { format: "markdown" as const } : language ? { format: "code" as const, language } : {}) };
    }
    else if (block.type === "image") yield `[Recorded image: ${clean(block.mimeType)}; native preview is retained outside groups]`;
    else yield* recordedValues(block);
  }
}
function* actionDetails(node: Node): Generator<PaneContent> {
  if (standardWrite(node) || compactFailure(node)) { yield { text: "Output", kind: "section" }; yield* outputSections(node); }
  yield { text: "Arguments", kind: "section" }; yield* recordedValues(node.args, 0, new Set(), argumentLanguages(node));
  const details = node.result?.details;
  const emptyDetails = details !== null && typeof details === "object" && !Array.isArray(details) && Object.keys(details).length === 0;
  if (details !== undefined && !emptyDetails) { yield { text: "Recorded details", kind: "section" }; yield* recordedValues(details, 0, new Set(), { diff: "diff", code: "javascript" }); }
}

function knownFailure(node: Node): { code: string; label: string } | undefined {
  if (node.status !== "failed") return;
  const details = node.result?.details;
  let reason = typeof details?.error === "string" ? details.error : typeof details?.errorMessage === "string" ? details.errorMessage : "";
  if (!reason) for (const block of node.result?.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      // Status comes from structured failure signals. This is a recorded excerpt, never error detection from prose.
      reason = block.text.slice(0, 512).trim().split(/\r?\n/, 1)[0];
      if (reason) break;
    }
  }
  // A short known category is enough here. Arbitrary prose and paths stay in Details.
  const sample = reason.slice(0, 512);
  const code = sample.match(/\b(ENAMETOOLONG|ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ETIMEDOUT|ECONNREFUSED|ENOSPC|ENOMEM|EEXIST)\b/)?.[1];
  if (code) {
    const categories: Record<string, string> = { ENAMETOOLONG: "Path too long", ENOENT: "File not found", EACCES: "Permission denied", EPERM: "Operation not permitted", EISDIR: "Expected a file", ENOTDIR: "Expected a directory", ETIMEDOUT: "Timed out", ECONNREFUSED: "Connection refused", ENOSPC: "No space left", ENOMEM: "Out of memory", EEXIST: "Already exists" };
    return { code, label: categories[code] };
  }
}
function failureReason(node: Node): string {
  if (node.status !== "failed") return "";
  const known = knownFailure(node);
  if (known) return known.label;
  const details = node.result?.details;
  if (typeof details?.exitCode === "number") return `Command failed (exit ${details.exitCode})`;
  return ["bash", "powershell"].includes(shortName(node.name)) ? "Command failed" : "Tool failed";
}
function questionState(node: Node): string {
  const statuses: Record<string, string> = { pending: "Pending", running: "Pending", failed: "Failed", answered: "Answered", cancelled: "Cancelled", unavailable: "Unavailable", unanswered: "Unanswered" };
  return statuses[node.status] || "Unanswered";
}
function questionTitle(node: Node): string {
  let answer = "";
  if (node.status === "answered") answer = ` · ${node.result.details.answers.slice(0, 3).map((item: any) => clean(item.label ?? item.value)).join("; ")}${node.result.details.answers.length > 3 ? "; …" : ""}`;
  return `Question · ${questionState(node)} · ${clean(node.result?.details?.question ?? node.args?.question)}${answer}`;
}
class DynamicComponent {
  constructor(private draw: (width: number) => string[], private mouse?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined, readonly owner?: Node) {}
  render(width: number) { return this.draw(Math.max(1, width)); }
  handleMouse(event: TuiMouseEvent) { return this.mouse?.(event); }
  [hiddenSubagent]?: () => boolean;
  invalidate() {}
}

/** Display-only tools: public renderer/event/input APIs; no messages or tool execution are changed. */
export function registerModernTools(pi: ExtensionAPI, mode: Mode): () => void {
  if (!nativeToolsSupported) return () => {};
  const subagents = acquireSubagentProjection(pi);
  let disposed = false;
  let epoch = 0;
  let nodes = new Map<string, Node>();
  let groups = new Map<string, Group>();
  let focused: ToolPane | CodePane | undefined;
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
  const release = (preserveAnchor = false) => { if (focused) { focused.focused = false; if (!preserveAnchor && focused instanceof ToolPane) focused.releaseInspection(); focused = undefined; } };
  const subagentView = (node: Node) => { subagents.sync(); return compactSubagent(node.name) ? subagents.projection.viewTool(node.id) : undefined; };
  const panes = () => [...nodes.values()].flatMap<ToolPane | CodePane>(node => subagentView(node) ? subagentView(node)!.hidden ? [] : [subagentView(node)!.pane] : node.group ? node.group.members[0] === node ? [node.group.pane] : [] : node.code ? node.code.content.supported ? [node.code] : [] : node.pane ? [node.pane] : []);
  const focusPane = (pane: ToolPane | CodePane) => {
    if (disposed || !mode.isEnabled() || !panes().includes(pane)) return;
    release(); focused = pane; pane.focused = true; pane.open = true; redraw();
    pi.events.emit("compact-renderer:focus:v1", { owner: "tools", label: pane.title,
      target: (component: any) => component instanceof DynamicComponent && (component.owner && subagentView(component.owner)?.pane || component.owner?.group?.pane || component.owner?.code || component.owner?.pane) === pane });
  };
  const action = (node: Node): PaneAction => ({ id: node.id, label: toolLabel(node.name, node.args) + indicators(node), sections: () => sections(node), ...(question(node.name) ? {} : { details: () => actionDetails(node) }) });
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
      group.pane.title = run.length === 1 ? toolLabel(run[0].name, run[0].args) : `${run.length} actions · ${groupIntent(run)}`;
      if (run.some(node => node.result?.details?.truncation?.truncated || node.result?.details?.truncated)) group.pane.title += " · output truncated";
      if (run.some(node => node.result?.details?.fullOutputPath)) group.pane.title += " · full output saved";
      if (run.some(node => node.result?.details?.warning || node.result?.details?.warnings?.length)) group.pane.title += " · warning recorded";
      for (const node of run) node.group = group;
      next.set(id, group); run = [];
    };
    for (const node of nodes.values()) {
      node.group = undefined;
      if (compactSubagent(node.name) || node.name === "codemode" || node.status !== "success" || node.result?.content?.some((block: any) => block.type === "image")) { finish(); continue; }
      if (run.length && node.epoch !== run[0].epoch) finish();
      run.push(node);
    }
    finish(); groups = next;
    if (focused && ![...groups.values()].some(group => group.pane === focused) && ![...nodes.values()].some(node => !node.group && (node.code || node.pane) === focused)) release();
  };
  const ensure = (id: string, name: string, args?: any, stock?: ToolRenderers) => {
    let node = nodes.get(id);
    if (!node) { node = { id, name, args, epoch, status: "pending", revision: 0, native: new NativeToolOwner(name, stock) }; nodes.set(id, node); }
    if (args !== undefined && node.args !== args) { node.args = args; node.revision++; node.pane?.reset(); }
    if (name === "codemode") node.code ||= new CodePane(height);
    return node;
  };
  const record = (node: Node, result: any, partial: boolean, error: boolean, force = false) => {
    if (node.code && !force && node.result?.content === result?.content && node.result?.details === result?.details && node.lastPartial === partial && node.lastError === error) { node.result = result; return; }
    node.lastPartial = partial; node.lastError = error;
    const next = node.code ? { status: (error || result?.isError ? "failed" : partial ? "running" : "success") as Status, note: undefined } : toolStatus(node.name, result, partial, error);
    const changed = force || node.result?.content !== result?.content || node.result?.details !== result?.details || node.status !== next.status || node.note !== next.note;
    node.result = result; node.note = next.note; node.status = next.status;
    if (!changed) return;
    node.revision++; node.pane?.reset();
    if (!rebuilding) refreshGroups();
  };
  const observeMessage = (message: any) => {
    if (message?.role === "assistant") {
      if (message.errorMessage || message.content?.some((block: any) => block.type === "text" && block.text?.trim())) epoch++;
      for (const call of message.content ?? []) if (call.type === "toolCall") {
        if (usesNativePresentation(call.name)) { epoch++; continue; }
        if (question(call.name)) epoch++;
        ensure(call.id, call.name, call.arguments);
        if (question(call.name)) epoch++;
      }
    } else if (message?.role === "toolResult") {
      if (usesNativePresentation(message.toolName || "")) { epoch++; return; }
      const node = ensure(message.toolCallId, message.toolName || "tool");
      record(node, message, false, !!message.isError, true);
      if (node.status !== "success") epoch++;
    } else if (message?.role !== "system" && !(message?.role === "custom" && message.display === false)) epoch++;
  };
  const clear = () => {
    release(); inputOff?.(); inputOff = undefined;
    for (const node of nodes.values()) { node.native.dispose(); node.code?.dispose(); }
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
        const choices = panes();
        if (!choices.length) return;
        focusPane(choices[(choices.indexOf(focused!) + 1) % choices.length]); return { consume: true };
      }
      if (!focused) return;
      if (data === "\u001b") { release(); pi.events.emit("compact-renderer:inspection-ended:v1", {}); redraw(); return { consume: true }; }
      if (focused.handle(data)) { redraw(); return { consume: true }; }
      // Editing belongs to the native editor. Release inspection before forwarding
      // the first typed character, paste, or editor key so Enter submits normally.
      release(); pi.events.emit("compact-renderer:inspection-ended:v1", {}); redraw();
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
    if (usesNativePresentation(event.toolName)) { epoch++; return; }
    if (question(event.toolName)) epoch++;
    const node = ensure(event.toolCallId, event.toolName, event.args); node.status = "running";
    if (question(event.toolName)) epoch++;
    refreshGroups();
  });
  on("tool_execution_update", (event: any) => {
    if (event.parentToolCallId || event.toolName !== "codemode") return;
    const node = ensure(event.toolCallId, event.toolName, event.args);
    record(node, event.partialResult, true, !!event.partialResult?.isError, true);
  });
  on("tool_execution_end", (event: any) => {
    if (event.parentToolCallId || usesNativePresentation(event.toolName)) return;
    const node = ensure(event.toolCallId, event.toolName);
    record(node, event.result, false, !!event.isError, true); node.native.suspend();
    if (node.status !== "success") epoch++;
    redraw();
  });
  subscriptions.push(pi.events.on("compact-renderer:inspect:v1", (request: any) => {
    if (disposed || !mode.isEnabled()) return;
    panes().forEach((pane, index) => request?.add?.({ id: `tool-${index}`, kind: "Tools", label: pane.title, focus: () => focusPane(pane) }));
  }));
  const focusOff = pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "tools") { release(); redraw(); } });
  if (typeof focusOff === "function") subscriptions.push(focusOff);
  subscriptions.push(mode.onChange(() => { release(); for (const node of nodes.values()) { node.native.suspend(); node.code?.suspend(); } redraw(); }));
  pi.registerToolRenderer((name, next) => {
    const stock = next();
    if (usesNativePresentation(name)) return stock;
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
      if (compactSubagent(name) && !node.result) node.status = context.executionStarted ? "running" : "pending";
      return node;
    };
    const singleCard = (node: Node) => compactSubagent(name) || question(name) || !!node.result && !["pending", "running", "success"].includes(node.status);
    const individual = (node: Node, theme?: any) => {
      const projected = subagentView(node);
      if (projected) {
        const pane = projected.pane;
        if (theme) { pane.theme = theme; pane.styleHeader = text => theme.fg(pane.headingTone, theme.bold(text)); }
        return pane;
      }
      node.pane ||= new ToolPane([action(node)], "", height);
      const status = node.note || node.status[0].toUpperCase() + node.status.slice(1);
      node.pane.title = compactSubagent(name) ? subagentTitle(name, node.args, node.result, node.status) + indicators(node) : question(name) ? questionTitle(node) : `${toolLabel(name, node.args)}${node.status === "success" ? "" : ` · ${node.status === "failed" ? "✗ Failed" : `… ${status}`}`}${indicators(node)}`;
      const reason = compactSubagent(name) ? "" : failureReason(node);
      if (reason) node.pane.title += ` · ${reason}`;
      if (theme) {
        node.pane.theme = theme;
        node.pane.styleHeader = text => theme.fg(node.status === "failed" ? "error" : question(name) || subagentDecision(name, node.args) ? "accent" : compactSubagent(name) && node.status === "notice" ? "warning" : "mdLink", theme.bold(text));
      }
      return node.pane;
    };
    const mouse = (pane: ToolPane | CodePane | undefined, event: TuiMouseEvent) => {
      if (!pane || disposed || !mode.isEnabled()) return undefined;
      const result = pane.handleMouse(event);
      if (result?.handled && result.render !== false) {
        release(true);
        pi.events.emit("compact-renderer:focus:v1", { owner: "editor" }); redraw();
      }
      // Native MouseRegion otherwise toggles the entire row for an out-of-bounds left click.
      if (!result && event.type === "click" && event.button === "left") return { handled: true, render: false };
      return result;
    };
    const syncExpansion = (node: Node, expanded: boolean) => {
      if ((node.nativeExpanded !== undefined && node.nativeExpanded !== expanded) || (node.nativeExpanded === undefined && expanded)) (node.group?.pane || node.code || individual(node)).open = expanded;
      node.nativeExpanded = expanded;
    };
    const codePane = (node: Node, theme: any, context: Context) => {
      const pane = node.code!;
      node.native.suspend(); pane.adoptClock(node.native.clock);
      const supported = pane.update(node.args, node.result, node.revision, context);
      if (!supported) { pane.suspend(); node.native.adoptClock(pane.clock); return false; }
      const calls = pane.content.calls;
      const { errors, cancelled, unresolved } = pane.content;
      const status = node.status === "failed" ? "✗ Failed" : context.isPartial ? context.executionStarted ? "… Running" : "Preparing" : "";
      pane.heading = `codemode${status ? ` · ${status}` : ""} · ${pane.content.intent}`;
      pane.title = `${pane.heading}${calls.length ? ` · ${calls.length} nested call${calls.length === 1 ? "" : "s"}` : ""}${errors ? ` · ${errors} nested error${errors === 1 ? "" : "s"}` : ""}${cancelled ? ` · ${cancelled} nested cancelled` : ""}${unresolved ? ` · ${unresolved} nested unresolved` : ""}${typeof context.durationMs === "number" ? ` · ${(context.durationMs / 1000).toFixed(2)}s` : ""}${indicators(node)}`;
      pane.setTheme(theme); pane.tone = node.status === "failed" ? "error" : errors || cancelled || unresolved && !context.isPartial ? "warning" : "syntaxVariable";
      return true;
    };
    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        if (disposed || !nativeToolContextSupported(context) || stale(context)) return stock?.renderCall?.(args, theme, { ...context, executionStarted: false, state: {}, lastComponent: undefined }) ?? new Text(json(args), 0, 0);
        const node = get(args, context);
        if (disposed || !mode.isEnabled()) { node.code?.suspend(); if (node.code) node.native.adoptClock(node.code.clock); return node.native.renderCall(args, theme, context); }
        if (node.code) {
          if (!codePane(node, theme, context)) node.native.renderCall(args, theme, context);
          syncExpansion(node, context.expanded);
          return new DynamicComponent(width => node.code!.content.supported ? node.code!.render(width) : node.native.renderCurrent(width), event => node.code!.content.supported ? mouse(node.code, event) : undefined, node);
        }
        node.native.suspend(); syncExpansion(node, context.expanded);
        return new DynamicComponent(width => {
          if (subagentView(node)?.hidden || node.group) return [];
          if (singleCard(node)) return individual(node, theme).render(width);
          return [activityRow(truncateToWidth(theme.fg("mdLink", theme.bold(`${node.result ? "" : "… "}${toolLabel(name, node.args)}${node.result ? "" : ` · ${context.executionStarted ? "running" : "preparing"}`}`)), cardContentWidth(width)), width, theme)];
        }, event => mouse(!subagentView(node)?.hidden && !node.group && singleCard(node) ? individual(node, theme) : undefined, event), node);
      },
      renderResult(result, options, theme, context) {
        if (disposed || !nativeToolContextSupported(context) || stale(context)) return stock?.renderResult?.(result, options, theme, { ...context, executionStarted: false, state: {}, lastComponent: undefined }) ?? nativeTextFallback(result, theme);
        const node = get(context.args, context); record(node, result, options.isPartial, context.isError);
        if (disposed || !mode.isEnabled()) { node.code?.suspend(); if (node.code) node.native.adoptClock(node.code.clock); return node.native.renderResult(result, options, theme, context); }
        if (node.code) {
          if (!codePane(node, theme, context)) { node.native.renderCall(node.args, theme, context); node.native.renderResult(result, options, theme, context); }
          syncExpansion(node, context.expanded);
          return new DynamicComponent(() => [], undefined, node);
        }
        node.native.suspend(); syncExpansion(node, context.expanded);
        return new DynamicComponent(width => {
          if (subagentView(node)?.hidden) return [];
          if (node.group) { const group = node.group; if (group.members[0] !== node) return []; group.pane.theme = theme; group.pane.styleHeader = text => theme.fg("mdLink", theme.bold(text)); return group.pane.render(width); }
          if (singleCard(node)) return [];
          return individual(node, theme).render(width);
        }, event => mouse(node.group ? node.group.members[0] === node ? node.group.pane : undefined : !singleCard(node) ? individual(node, theme) : undefined, event), node);
      },
    };
  });
  return () => { if (disposed) return; disposed = true; clear(); subagents.release(); for (const off of subscriptions.splice(0)) off(); };
}
