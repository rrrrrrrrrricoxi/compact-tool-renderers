import { VERSION, highlightCode, getLanguageFromPath, type ExtensionAPI, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

type Context = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Theme = Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];
type Status = "queued" | "running" | "ok" | "error" | "cancelled" | "started";
import { GroupPane, readableText, readableValue, detailRows, actionCard, roundedDuration } from "./group-pane.ts";
import { paneBodyHeight } from "./prompt-blocks.ts";
type Group = { members: Node[]; dirty: boolean; owner?: Node; pane?: GroupPane; theme?: Theme; revision?: number }; 
type Node = { id: string; name: string; group: Group; status: Status; images: number; truncated: boolean; saved: boolean; args?: any; result?: any; renderer?: ToolRenderers; context?: Context; caption?: string; nestedCalls?: any; individualPane?: GroupPane }; 
const categories: Record<string, string> = { read: "Read file", write: "Write file", edit: "Edit file", bash: "Shell command", powershell: "PowerShell command", grep: "Search file contents", find: "Find files", ls: "List files", ask_question: "Ask a question", web_search: "Search the web", web_fetch: "Read web page" };
const cleanName = (name: string) => name.split("__").at(-1)!.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 36) || "tool";

export function resultState(name: string, result: any, partial = false, isError = false) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  let details = result?.details;
  if (!details && text.length < 100000 && /^[{[]/.test(text.trim())) {
    try { details = JSON.parse(text); } catch { /* Display metadata only. */ }
  }
  const calls = Array.isArray(details?.calls) ? details.calls : [];
  const exit = typeof details?.exitCode === "number" ? details.exitCode : /(?:Process exited with (?:code|status)|exit code:)\s*(-?\d+)/i.exec(text)?.[1];
  const error = isError || result?.isError === true || details?.isError === true || ["error", "failed"].includes(details?.status)
    || ((name === "bash" || name === "powershell") && exit !== undefined && Number(exit) !== 0)
    || (name === "codemode" && (/^Script failed\b/.test(text) || calls.some((c: any) => c.status === "error")));
  const cancelled = details?.status === "cancelled" || (name === "codemode" && calls.some((c: any) => c.status === "cancelled"));
  const status: Status = error ? "error" : cancelled ? "cancelled" : partial ? "running" : details?.status === "started" ? "started" : "ok";
  return { status, images: content.filter((c: any) => c.type === "image").length,
    truncated: Boolean(details?.truncated || details?.truncation?.truncated), saved: Boolean(details?.fullOutputPath) };
}
const eligible = (node: Node) => !["error", "cancelled", "started"].includes(node.status) && !node.images;
function representative(group: Group): Node | undefined {
  if (!group.dirty) return group.owner;
  group.owner = undefined;
  for (let i = group.members.length - 1; i >= 0; i--) {
    if (eligible(group.members[i])) { group.owner = group.members[i]; break; }
  }
  group.dirty = false;
  return group.owner;
}

function argumentRows(name: string, args: any, raw: boolean, width: number, theme: Theme): string[] {
  if (raw) return detailRows("", JSON.stringify(args ?? {}, null, 2), width, theme);
  if (!args || typeof args !== "object") return detailRows("", readableValue(args ?? null), width, theme);
  const rest = { ...args };
  const sourceKey = name === "codemode" ? "code" : ["bash", "powershell"].includes(name) ? "command" : name === "write" ? "content" : undefined;
  const source = sourceKey && typeof rest[sourceKey] === "string" ? rest[sourceKey] : undefined;
  if (source !== undefined) delete rest[sourceKey!];
  const rows = Object.keys(rest).length ? detailRows("", readableValue(rest), width, theme) : [];
  if (source !== undefined) {
    const lang = name === "codemode" ? "javascript" : name === "bash" ? "bash" : name === "powershell" ? "powershell" : getLanguageFromPath(String(args.path ?? args.file_path ?? ""));
    const code = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    rows.push(...new Text(lang ? highlightCode(code, lang).join("\n") : code.split("\n").map(line => theme.fg("toolOutput", line)).join("\n"), 0, 0).render(width));
  }
  return rows;
}
function memberRows(member: Node, ordinal: string, width: number, raw: boolean, theme: Theme, highlight = true): string[] {
  const innerWidth = Math.max(1, width - (width > 2 ? 2 : 0));
  const body: string[] = [];
  try {
    if (member.args !== undefined) body.push(...argumentRows(member.name, member.args, raw, innerWidth, theme));
    const recorded = member.result?.details?.calls;
    const nested = Array.isArray(recorded) && recorded.length ? recorded : member.nestedCalls?.calls;
    if (Array.isArray(nested)) nested.forEach((call: any, j: number) => {
      let args = call.arguments;
      if (typeof call.args === "string") { try { args = JSON.parse(call.args); } catch { args = call.args; } }
      const name = call.name || "tool";
      const nestedBody = args === undefined ? detailRows("", "[arguments not recorded]", Math.max(1, innerWidth - 2), theme) : argumentRows(name, args, raw, Math.max(1, innerWidth - 2), theme);
      if (call.error) nestedBody.push(...detailRows("Recorded error", String(call.error), Math.max(1, innerWidth - 2), theme, "error"));
      body.push(...actionCard(`${ordinal.split("/")[0]}.${j + 1} · ${cleanName(name)} · ${categories[name] || "Recorded operation"} · ${call.status || "unknown"}${typeof call.durationMs === "number" ? ` · ${roundedDuration(call.durationMs)}` : ""}`, nestedBody, innerWidth, theme, call.status, highlight));
    });
    if (member.nestedCalls?.complete === false) body.push(...detailRows("Nested record incomplete", "Arguments/calls may have been omitted.", innerWidth, theme, "warning"));
    if (member.result) {
      const text = member.result.content.filter((c: any) => c.type === "text").map((c: any) => raw ? c.text : readableText(c.text)).join("\n");
      if (raw || member.name === "codemode" || !member.renderer || !member.context) {
        body.push(...detailRows(member.name === "codemode" ? "Script output (not attributed to nested calls)" : "Output", text, innerWidth, theme, member.status === "error" ? "error" : "toolOutput"));
      } else {
        const ctx = { ...member.context, args: member.args, expanded: true, lastComponent: undefined, executionStarted: false, isPartial: member.status === "running", isError: member.status === "error", state: {} };
        const result = ["read", "grep", "find", "ls", "bash", "powershell", "edit", "write"].includes(member.name) ? member.result : { ...member.result, content: member.result.content.map((c: any) => c.type === "text" ? { ...c, text: readableText(c.text) } : c) };
        body.push(...member.renderer.renderResult!(result, { expanded: true, isPartial: member.status === "running" }, theme, ctx).render(innerWidth));
      }
      if (member.result.details?.fullOutputPath) body.push(...detailRows("Full output saved", String(member.result.details.fullOutputPath), innerWidth, theme));
      if (member.truncated) body.push(...detailRows("", "Recorded output truncated; raw details retain the notice.", innerWidth, theme, "warning"));
      if (raw && member.result.details) body.push(...detailRows("Recorded details", JSON.stringify(member.result.details, null, 2), innerWidth, theme));
    }
  } catch {
    body.push(...detailRows("Recorded detail fallback", JSON.stringify(member.args ?? {}, null, 2) + "\n" + (member.result?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"), innerWidth, theme));
  }
  return actionCard(`${ordinal} · ${cleanName(member.name)} · ${categories[member.name] && !["bash", "powershell"].includes(member.name) ? categories[member.name] : member.caption || categories[member.name] || "Recorded operation"} · ${member.status}`, body, width, theme, member.status, highlight);
}

// Display-only references to recorded calls/results; never rewrite messages or execute tools.
export class QuietGroups {
  nodes = new Map<string, Node>();
  activePane?: GroupPane;
  getPaneStyle = () => ({ frame: true, bodyHighlight: true });
  onControl: (action: string) => void = () => {};
  onInteract: () => void = () => {};
  paneState() { return { available: [...this.nodes.values()].some(n => representative(n.group) === n && !!n.group.pane), open: !!this.activePane?.isOpen, raw: !!this.activePane?.raw, actions: this.activePane?.navigation || [] }; }
  paneAction(action: string) {
    if (VERSION !== "1.1.0") return false;
    if (action === "refresh") { for (const fn of this.invalidators.values()) fn(); return true; }
    const pane = action === "open" ? [...this.nodes.values()].reverse().find(n => representative(n.group) === n)?.group.pane : this.activePane;
    if (!pane || (action !== "open" && !pane.isOpen)) return false;
    this.activePane = pane;
    this.onInteract();
    if (action === "open") { pane.open = true; for (const fn of this.invalidators.values()) fn(); }
    else pane.action(action);
    return true;
  }
  pane(node: Node, theme: Theme, getHeight: () => number, invalidate: () => void) {
    node.group.theme = theme;
    node.group.pane ||= new GroupPane(() => this.summary(representative(node.group)?.id || ""), (width, raw) => {
      const rows: string[] = [], actions: { row: number; label: string }[] = [];
      node.group.members.forEach((member, i) => {
        const target = member.args?.path ?? member.args?.file_path ?? member.caption ?? "";
        actions.push({ row: rows.length, label: `${cleanName(member.name)} · ${categories[member.name] || "Operation"} · ${String(target).replace(/[\r\n\t\x1b]/g, " ").slice(0, 80)} · ${member.status}` });
        rows.push(...memberRows(member, `${i + 1}/${node.group.members.length}`, width, raw, node.group.theme!, this.getPaneStyle().bodyHighlight));
      });
      return { rows, actions };
    }, getHeight, () => node.group.theme!, invalidate, () => node.group.revision || 0, () => this.getPaneStyle());
    node.group.pane.onControl = action => { this.activePane = node.group.pane; this.onInteract(); this.onControl(action); };
    return node.group.pane;
  }
  individualPane(node: Node, getHeight: () => number, invalidate: () => void) {
    node.individualPane ||= new GroupPane(() => `${cleanName(node.name)} · ${node.status}`, (width, raw) => memberRows(node, "1/1", width, raw, node.group.theme!, this.getPaneStyle().bodyHighlight), getHeight, () => node.group.theme!, invalidate, () => node.group.revision || 0, () => this.getPaneStyle());
    node.individualPane.onControl = action => { this.activePane = node.individualPane; this.onInteract(); this.onControl(action); };
    return node.individualPane;
  }
  private invalidators = new Map<string, () => void>();
  private current: Group | undefined;
  private rebuilding = false;
  private ensure(id: string, name: string, grouped = false): Node {
    const existing = this.nodes.get(id);
    if (existing) {
      if (existing.name === "tool" && name !== "tool") existing.name = name;
      return existing;
    }
    const group: Group = grouped ? this.current ||= { members: [], dirty: true } : { members: [], dirty: true };
    const node: Node = { id, name, group, status: "queued", images: 0, truncated: false, saved: false };
    group.members.push(node); group.dirty = true; group.revision = (group.revision || 0) + 1; this.nodes.set(id, node);
    return node;
  }
  private redraw(ids: (string | undefined)[]) {
    if (this.rebuilding) return;
    for (const id of new Set(ids)) if (id) this.invalidators.get(id)?.();
  }
  observe(id: string, name: string, invalidate?: () => void) {
    if (invalidate) this.invalidators.set(id, invalidate);
    return this.ensure(id, name);
  }
  boundary() { this.current = undefined; }
  assistant(message: any) {
    const content = Array.isArray(message.content) ? message.content : [];
    // Do not merge across visible prose. Thinking alone is not a conversation boundary.
    if (message.errorMessage || content.some((c: any) => c.type === "text" && c.text?.trim())) this.boundary();
    const calls = content.filter((c: any) => c.type === "toolCall" && typeof c.id === "string");
    if (!calls.length) return;
    const group = this.current ||= { members: [], dirty: true };
    const before = representative(group)?.id;
    const changed: string[] = [];
    for (const call of calls) {
      const node = this.ensure(call.id, call.name || "tool");
      if (node.args !== call.arguments) node.group.revision = (node.group.revision || 0) + 1;
      node.args = call.arguments;
      if (node.group !== group) {
        node.group.members = node.group.members.filter(member => member !== node);
        node.group.dirty = true; node.group.revision = (node.group.revision || 0) + 1;
        node.group = group; group.members.push(node); group.dirty = true; group.revision = (group.revision || 0) + 1;
      }
      changed.push(node.id);
    }
    this.redraw([before, representative(group)?.id, ...changed]);
  }
  start(id: string, name: string) {
    const node = this.ensure(id, name, true);
    if (node.status !== "queued") return;
    node.status = "running"; node.group.revision = (node.group.revision || 0) + 1;
    this.redraw([id, representative(node.group)?.id]);
  }
  result(id: string, name: string, result: any, partial = false, isError = false, notify = true) {
    const node = this.ensure(id, name);
    const before = representative(node.group)?.id;
    if (node.result?.content !== result.content || node.result?.details !== result.details || result.nestedCalls && node.nestedCalls !== result.nestedCalls) node.group.revision = (node.group.revision || 0) + 1;
    node.result = result;
    if (result.nestedCalls) node.nestedCalls = result.nestedCalls;
    const next = resultState(name, result, partial, isError);
    if (node.status === next.status && node.images === next.images && node.truncated === next.truncated && node.saved === next.saved) return next;
    Object.assign(node, next); node.group.dirty = true; node.group.revision = (node.group.revision || 0) + 1;
    if (notify) this.redraw([before, representative(node.group)?.id, id]);
    return next;
  }
  message(message: any) {
    if (message.role === "assistant") this.assistant(message);
    else if (message.role === "toolResult" && typeof message.toolCallId === "string") this.result(message.toolCallId, message.toolName || "tool", message, false, message.isError);
    else if (message.role !== "system" && !(message.role === "custom" && message.display === false)) this.boundary();
  }
  rebuild(entries: readonly any[]) {
    this.activePane = undefined;
    this.nodes.clear(); this.invalidators.clear(); this.boundary(); this.rebuilding = true;
    try {
      for (const entry of entries) {
        if (entry.type === "message") this.message(entry.message);
        else if (["compaction", "branch_summary"].includes(entry.type) || (entry.type === "custom_message" && entry.display !== false)) this.boundary();
      }
    } finally { this.rebuilding = false; }
  }
  clear() { this.rebuild([]); }
  info(id: string) { return this.nodes.get(id); }
  summary(id: string): string | undefined {
    const node = this.nodes.get(id);
    if (!node || !eligible(node) || representative(node.group) !== node) return undefined;
    const members = node.group.members;
    const counts = new Map<string, number>();
    for (const member of members) { const name = cleanName(member.name); counts.set(name, (counts.get(name) || 0) + 1); }
    const names = [...counts].slice(0, 3).map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(", ");
    const rest = counts.size > 3 ? ` +${counts.size - 3} types` : "";
    const active = members.filter(m => m.status === "running" || m.status === "queued");
    const failed = members.filter(m => m.status === "error").length;
    const count = `${members.length} call${members.length === 1 ? "" : "s"}`;
    let text = active.length ? `… Tools · ${members.length - active.length}/${members.length} settled · ${active.some(m => m.status === "running") ? "running" : "preparing"} ${[...new Set(active.map(m => cleanName(m.name)))].slice(0, 2).join(", ")}` : `Tools · ${count}`;
    text += ` · ${names}${rest}`;
    if (failed) text += ` · ${failed} failed`;
    if (members.some(m => m.truncated)) text += " · truncated";
    if (members.some(m => m.saved)) text += " · full output saved";
    return text;
  }
}

export function registerQuietGroups(pi: ExtensionAPI): QuietGroups {
  const groups = new QuietGroups();
  const rebuild = (_event: unknown, ctx: any) => groups.rebuild(ctx.sessionManager.getBranch());
  pi.on("session_start", rebuild);
  pi.on("session_switch", rebuild);
  pi.on("session_tree", rebuild);
  pi.on("session_compact", rebuild);
  pi.on("session_shutdown", () => groups.clear());
  pi.on("message_end", event => { groups.message(event.message); });
  pi.on("tool_execution_start", event => { if (!event.parentToolCallId) groups.start(event.toolCallId, event.toolName); });
  pi.on("tool_execution_end", event => { if (!event.parentToolCallId) groups.result(event.toolCallId, event.toolName, event.result, false, event.isError); });
  return groups;
}

function neutral(text: string, width: number, theme: Theme, context: Context): string[] {
  const pad = Math.min(Math.max(0, context.outputPad || 0), Math.floor(width / 2));
  return [theme.fg("muted", truncateToWidth(" ".repeat(pad) + text, Math.max(1, width), "…"))];
}
export function quietRenderer(name: string, compact: ToolRenderers, groups: QuietGroups, getMode: () => string, caption: (args: any) => string, getHeight: () => number = () => paneBodyHeight("auto")): ToolRenderers {
  const quiet = (context: Context) => getMode() === "quiet" && VERSION === "1.1.0" && typeof context.toolCallId === "string";
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      if (!quiet(context)) return compact.renderCall!(args, theme, context);
      const observed = groups.observe(context.toolCallId, name, context.invalidate);
      if (observed.args !== args) observed.group.revision = (observed.group.revision || 0) + 1;
      Object.assign(observed, { args, renderer: compact, context, caption: caption(args) });
      const pane = groups.pane(observed, theme, getHeight, context.invalidate);
      const individual = () => groups.individualPane(observed, getHeight, context.invalidate);
      // Dynamic components let the former group representative become truly zero-height.
      // Pi's self shell suppresses its separator too when both slots are empty.
      return {
        render(width) {
          const node = groups.info(context.toolCallId);
          if (node && !eligible(node) && context.expanded) { const detail = individual(); groups.activePane = detail; return detail.render(width, true); }
          if (node?.status === "error") return compact.renderCall!(args, theme, { ...context, isError: true }).render(width);
          if (node && !eligible(node)) {
            const status = node.status === "started" ? "started" : node.status === "cancelled" ? "⊘ cancelled" : `${node.images} image${node.images === 1 ? "" : "s"}`;
            return neutral(`${cleanName(name)} · ${caption(args)} · ${status}`, width, theme, context);
          }
          const summary = groups.summary(context.toolCallId);
          if (summary && context.expanded) groups.activePane = pane;
          return summary ? pane.render(width, context.expanded) : [];
        },
        handleMouse(event: any) {
          if (groups.summary(context.toolCallId)) {
            const result = pane.handleMouse(event, context.expanded);
            if (result?.handled) { groups.activePane = pane; groups.onInteract(); }
            return result;
          }
          if (context.expanded && !eligible(observed)) {
            const result = individual().handleMouse(event, true);
            if (result?.handled) groups.onInteract();
            return result;
          }
          return undefined;
        },
        invalidate() {}, 
      };
    },
    renderResult(result, options, theme, context) {
      if (!quiet({ ...context, expanded: options.expanded })) return compact.renderResult!(result, options, theme, context);
      groups.observe(context.toolCallId, name, context.invalidate);
      // Rendering must not trigger recursive invalidate -> updateDisplay -> renderResult.
      // Events/replay normally supply this state; silently update only if needed (e.g. export).
      const next = groups.result(context.toolCallId, name, result, options.isPartial, context.isError, false);
      // Stop the stock shell clock if this row was previously expanded while streaming.
      if ((name === "bash" || name === "powershell") && context.state?.interval) {
        clearInterval(context.state.interval); context.state.interval = undefined;
      }
      const error = next.status === "error" && !options.expanded ? compact.renderResult!(result, options, theme, { ...context, isError: true }) : undefined;
      return { render: width => error ? error.render(width) : [], invalidate() { error?.invalidate(); } };
    },
  };
}
