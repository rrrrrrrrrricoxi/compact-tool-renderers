import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import registerPromptBlocks from "./prompt-blocks.ts";
import registerThinkingPreview from "./thinking-preview.ts";
import registerSubagentCards, { type ReportTarget } from "./subagent-cards.ts";
import { registerQuietGroups, quietRenderer } from "./quiet-tools.ts";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
type RenderTheme = Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];
type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

type Call = { name?: string; status?: string; error?: string };
const clean = (value: string) => value.replace(/[\r\n\t\x1b]/g, " ").replace(/\s+/g, " ").trim();
function shortName(name: string): string {
  const tail = name.split("__").at(-1) || name;
  return tail.length > 32 ? `${tail.slice(0, 29)}...` : tail;
}
function shaded(component: Component, theme: RenderTheme, context: RenderContext): Component {
  const background = context.isError ? "toolErrorBg" : context.isPartial ? "toolPendingBg" : "toolSuccessBg";
  return {
    render(width) {
      const pad = Math.min(Math.max(0, context.outputPad || 0), Math.floor(width / 2));
      return component.render(Math.max(1, width - pad * 2)).map(line => {
        const padded = truncateToWidth(" ".repeat(pad) + line, width);
        return theme.bg(background, padded + " ".repeat(Math.max(0, width - visibleWidth(padded))));
      });
    },
    invalidate() { component.invalidate(); },
  };
}
function singleLine(text: string, theme: RenderTheme, context: RenderContext): Component {
  return shaded({
    render: (width: number) => [truncateToWidth(text, Math.max(1, width), "…")],
    invalidate() {},
  }, theme, context);
}
function displaySource(source: string): string {
  // Hide legacy label comments only in the leading comment block, never inside executable code/data.
  let leading = true;
  return source.split("\n").filter(line => {
    if (leading && /^\s*(?:#|\/\/)\s*intent:/i.test(line)) return false;
    if (line.trim() && !/^\s*(?:#|\/\/)/.test(line)) leading = false;
    return true;
  }).join("\n");
}
function intent(source: string, kind: "bash" | "codemode"): string {
  // Historical labels remain usable, but new calls need no annotations or prompt changes.
  const leading = source.split("\n").slice(0, 4).join("\n");
  const explicit = /^\s*(?:#|\/\/)\s*intent:\s*(.+)$/im.exec(leading)?.[1];
  if (explicit) return clean(explicit).slice(0, 120);
  if (kind === "codemode") return "Run a tool script";
  const command = source.split("\n").find(line => line.trim() && !line.trim().startsWith("#"))?.trim() || "";
  if (/^(?:rg|grep)\b/.test(command)) {
    return /contextWindow|272000|gpt-6/.test(source) ? "Search model and context-limit definitions" : "Search files for matching text";
  }
  if (/^find\b/.test(command)) return "Locate matching files";
  if (/^ls\b/.test(command)) return "List files";
  if (/^(?:python3?|node)\b/.test(command)) return /(?:test\.mjs|test\.js|pytest|unittest)/.test(command) ? "Run tests" : /^python/.test(command) ? "Run a Python script" : "Run a JavaScript script";
  if (/^npm\s+test\b/.test(command)) return "Run tests";
  if (/^git\s+status\b/.test(command)) return "Check repository changes";
  if (/^git\s+diff\b/.test(command)) return "Inspect repository differences";
  return "Run a shell command";
}

function compactFileAndShell(name: string, stock: ToolRenderers | undefined): ToolRenderers {
  const shell = name === "bash" || name === "powershell";
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      if (shell && context.executionStarted && context.state.startedAt === undefined) {
        context.state.startedAt = Date.now();
      }
      if (shell && context.expanded) {
        const command = typeof args?.command === "string" ? displaySource(args.command) : "[pending command]";
        return shaded(new Text(theme.fg("toolTitle", theme.bold(name)) + "\n" + theme.fg("toolOutput", command), 0, 0), theme, context);
      }
      if (name !== "edit" && context.expanded && stock?.renderCall) {
        // Stock components have their own methods/caches; never pass our compact component to them.
        return shaded(stock.renderCall(args, theme, { ...context, lastComponent: undefined }), theme, context);
      }
      if (name === "write" || name === "edit") {
        const path = typeof (args?.path ?? args?.file_path) === "string" ? args.path ?? args.file_path : "[pending path]";
        const home = process.env.HOME;
        const displayPath = home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
        if (typeof args?.content === "string") {
          context.state.compactWriteLines = args.content === "" ? 0 : args.content.replace(/\n$/, "").split("\n").length;
        }
        if (name === "edit") {
          context.state.compactEditCount = Array.isArray(args?.edits) ? args.edits.length : typeof args?.oldText === "string" && typeof args?.newText === "string" ? 1 : undefined;
        }
        return singleLine(theme.fg("toolTitle", theme.bold(name)) + theme.fg("muted", name === "edit" ? " · Edit file · " : " · Write file · ") + theme.fg("accent", clean(displayPath)), theme, context);
      }
      const command = typeof args?.command === "string" ? args.command : "[pending command]";
      return singleLine(theme.fg("toolTitle", theme.bold(name)) + " · " + theme.fg("accent", name === "powershell" ? "Run a PowerShell command" : intent(command, "bash")) + theme.fg("muted", " · Ctrl+O for command"), theme, context);
    },
    renderResult(result, options, theme, context) {
      // The stock bash renderer starts a live clock on expansion. Stop it on collapse/finalization.
      if (shell && context.state.interval && (!options.expanded || !options.isPartial || context.isError)) {
        clearInterval(context.state.interval);
        context.state.interval = undefined;
      }
      if (options.expanded && stock?.renderResult) {
        // Edit's stock call renderer previews by re-reading the file and ignores expansion.
        // Render the recorded result diff directly instead: no live preview or duplicated diff.
        const stockContext = name === "edit" ? { ...context, state: { ...context.state, callComponent: undefined }, lastComponent: undefined } : { ...context, lastComponent: undefined };
        return shaded(stock.renderResult(result, options, theme, stockContext), theme, context);
      }
      const output = result.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
      const exitMatch = /(?:Process exited with (?:code|status)|exit code:)\s*(-?\d+)/i.exec(output);
      const exitCode = typeof result.details?.exitCode === "number" ? result.details.exitCode : exitMatch ? Number(exitMatch[1]) : undefined;
      const error = context.isError || (shell && exitCode !== undefined && exitCode !== 0);
      const partial = options.isPartial && !error;
      let line = error ? "✗ Failed" : partial ? "… Running" : name === "write" ? "✓ Written" : name === "edit" ? "✓ Edited" : "✓ Completed";
      if (name === "edit" && !partial && !error) {
        const count = context.state.compactEditCount;
        if (count !== undefined) line += ` · ${count} replacement${count === 1 ? "" : "s"}`;
        if (typeof result.details?.diff === "string") {
          const lines = result.details.diff.split("\n");
          const added = lines.filter((s: string) => s.startsWith("+") && !s.startsWith("+++")).length;
          const removed = lines.filter((s: string) => s.startsWith("-") && !s.startsWith("---")).length;
          line += ` · +${added} / −${removed} lines`;
        }
        line += " · Ctrl+O for diff";
      }
      if (name === "write" && !partial && !error && context.state.compactWriteLines !== undefined) {
        const lines = context.state.compactWriteLines;
        line += ` · ${lines} line${lines === 1 ? "" : "s"}`;
      }
      if (context.durationMs !== undefined && !options.isPartial) line += ` · ${(context.durationMs / 1000).toFixed(1)}s`;
      if (error) {
        if (exitCode !== undefined) line += ` · exit ${exitCode}`;
        const excerpt = output.split("\n").map(s => s.trim()).filter(Boolean).slice(-2).join(" · ");
        if (excerpt) line += ` · ${clean(excerpt).slice(0, 140)}`;
        else line += " · expand for details";
      } else if (shell && output) {
        line += " · output hidden";
      }
      if (result.details?.fullOutputPath) line += " · full output saved";
      else if (result.details?.truncation?.truncated) line += " · output truncated";
      return singleLine(theme.fg(error ? "error" : partial ? "warning" : "success", line), theme, { ...context, isError: error, isPartial: partial });
    },
  };
}

function genericTitle(name: string, args: Record<string, unknown> | undefined): string {
  if (name === "web_search") return "Search the web" + (typeof args?.query === "string" ? ` · ${clean(args.query).slice(0, 120)}` : "");
  if (name === "web_fetch") {
    try {
      const url = new URL(String(args?.url));
      return `Read web page · ${url.hostname}${url.pathname}`;
    } catch { return "Read web page"; }
  }
  if (name === "research_guard") return "Check research guardrails";
  if (name === "powershell") return "Run a PowerShell command";
  if (name === "subagent") return `Start ${clean(String(args?.agent || "agent"))}`;
  if (name === "subagent_message") return `Message ${clean(String(args?.name || "agent"))}`;
  const categories: Record<string, string> = { ask_question: "Ask a question", read: "Read file", grep: "Search file contents", find: "Find files", ls: "List files" };
  const category = categories[name] || (/^mcp__/.test(name) ? "MCP tool" : "Run tool");
  const path = args?.path ?? args?.file_path;
  const home = process.env.HOME;
  const target = typeof path === "string" ? home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path : "";
  return category + (target ? ` · ${clean(target)}` : "");
}

function compactGeneric(name: string, stock: ToolRenderers | undefined): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      if (context.expanded) {
        if (stock?.renderCall) return shaded(stock.renderCall(args, theme, { ...context, lastComponent: undefined }), theme, context);
        // The default Pi call renderer shows complete JSON arguments. Keep that on expansion only.
        return shaded(new Text(theme.fg("toolTitle", theme.bold(name)) + "\n" + theme.fg("toolOutput", JSON.stringify(args ?? {}, null, 2)), 0, 0), theme, context);
      }
      return singleLine(theme.fg("toolTitle", theme.bold(name)) + " · " + theme.fg("accent", genericTitle(name, args)), theme, context);
    },
    renderResult(result, options, theme, context) {
      if (options.expanded) {
        if (stock?.renderResult) return shaded(stock.renderResult(result, options, theme, { ...context, lastComponent: undefined }), theme, context);
        // Pi itself renders inline images separately; don't duplicate or discard them here.
        const text = result.content.map(c => c.type === "text" ? c.text : c.type === "image" ? `[Image: ${c.mimeType}]` : `[${c.type}]`).join("\n");
        return shaded(new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0), theme, context);
      }
      const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
      let structured = result.details;
      // No second model request or network access: inspect only an existing small JSON response.
      if (!structured && text.length < 100000 && /^[{[]/.test(text)) {
        try { structured = JSON.parse(text); } catch { /* Plain/truncated output: use generic counts. */ }
      }
      const error = context.isError || structured?.isError === true || ["error", "failed"].includes(structured?.status);
      const cancelled = structured?.status === "cancelled";
      const partial = options.isPartial && !error && !cancelled;
      let line = error ? "✗ Failed" : cancelled ? "⊘ Cancelled" : partial ? "… Running" : structured?.status === "started" ? "✓ Started" : "✓ Completed";
      if (error) {
        const detail = typeof structured?.error === "string" ? structured.error : text;
        line += detail ? ` · ${clean(detail).slice(0, 140)}` : " · expand for error details";
      } else if (!partial) {
        if (name === "web_search" && Array.isArray(structured?.results)) {
          const count = structured.results.length;
          line += ` · ${count} result${count === 1 ? "" : "s"}`;
        } else if (text) {
          const count = text.split("\n").length;
          line += ` · ${count} output line${count === 1 ? "" : "s"}`;
        }
        const images = result.content.filter(c => c.type === "image").length;
        if (images) line += ` · ${images} image${images === 1 ? "" : "s"}`;
      }
      if (!options.isPartial && context.durationMs !== undefined) line += ` · ${(context.durationMs / 1000).toFixed(1)}s`;
      if (structured?.fullOutputPath) line += " · full output saved";
      if (structured?.truncation?.truncated || structured?.truncated) line += " · truncated";
      line += " · Ctrl+O for details";
      return singleLine(theme.fg(error ? "error" : partial ? "warning" : cancelled ? "muted" : "success", line), theme, { ...context, isError: error, isPartial: partial });
    },
  };
}

// Last actual details interaction wins; background/native renders never select.
export function activeDetails(groups: { paneAction(action: string): boolean; paneState(): any; onInteract: () => void }, getMode: () => string) {
  let report: ReportTarget | undefined;
  const selected = () => { if (report && !report.valid()) report = undefined; return report; };
  const router = {
    select(target: ReportTarget) { report = target; },
    reset() { report = undefined; },
    state() { return selected()?.state() || { ...groups.paneState(), kind: "tools", scrollable: true }; },
    action(action: string) {
      if (action === "refresh") { const acted = selected()?.action(action) || false; return groups.paneAction(action) || acted; }
      if (action === "open latest") { report = undefined; return getMode() === "quiet" && groups.paneAction("open"); }
      const target = selected();
      return target ? target.action(action) : getMode() === "quiet" && groups.paneAction(action);
    },
  };
  groups.onInteract = router.reset;
  return router;
}

export default function compactToolRenderers(pi: ExtensionAPI): void {
  const groups = registerQuietGroups(pi);
  const details = activeDetails(groups, () => display.getMode());
  let thinking: ReturnType<typeof registerThinkingPreview> | undefined;
  const display = registerPromptBlocks(pi, details.action, details.state, { state: () => thinking?.state() || { available: false, open: false, rounds: 0 }, action: action => thinking?.action(action) || false });
  groups.getPaneStyle = display.getPaneStyle;
  groups.onControl = action => { void display.control(action); };
  thinking = registerThinkingPreview(pi, display.getMode, display.getPaneHeight, display.getPaneStyle);
  registerSubagentCards(pi, display.getMode, { height: display.getPaneHeight, style: display.getPaneStyle,
    onInteract: details.select, onReset: details.reset, onControl: action => { void display.control(action); } });
  pi.registerToolRenderer((name, next): ToolRenderers | undefined => {
    const stock = next();
    const wrap = (renderer: ToolRenderers) => quietRenderer(name, renderer, groups, display.getMode, args =>
      name === "bash" ? intent(typeof args?.command === "string" ? args.command : "", "bash") :
      name === "codemode" ? "Run a tool script" : genericTitle(name, args), display.getPaneHeight);
    if (["write", "bash", "powershell", "edit"].includes(name)) return wrap(compactFileAndShell(name, stock));
    if (name !== "codemode") return wrap(compactGeneric(name, stock));
    return wrap({
      // Compact colored rows without vertical padding; retain expansion controls.
      renderShell: "self",
      renderCall(args, theme, context) {
        if (context.expanded && stock?.renderCall) {
          const displayArgs = typeof args?.code === "string" ? { ...args, code: displaySource(args.code) } : args;
          return shaded(stock.renderCall(displayArgs, theme, { ...context, lastComponent: undefined }), theme, context);
        }
        return singleLine(theme.fg("toolTitle", theme.bold("codemode")) + " · " + theme.fg("accent", intent(typeof args?.code === "string" ? args.code : "", "codemode")) + theme.fg("muted", " · Ctrl+O for details"), theme, context);
      },
      renderResult(result, options, theme, context) {
        if (options.expanded) {
          if (stock?.renderResult) return shaded(stock.renderResult(result, options, theme, { ...context, lastComponent: undefined }), theme, context);
          return shaded(new Text(result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), 0, 0), theme, context);
        }
        const calls: Call[] = Array.isArray(result.details?.calls) ? result.details.calls : [];
        const failed = calls.filter(c => c.status === "error");
        const cancelled = calls.filter(c => c.status === "cancelled");
        const running = calls.filter(c => c.status === "running");
        const header = result.content.find(c => c.type === "text")?.text || "";
        const error = context.isError || /^Script failed\b/.test(header) || failed.length > 0;
        const icon = error ? "✗" : options.isPartial || running.length ? "…" : cancelled.length ? "⊘" : "✓";
        const color = error ? "error" : options.isPartial || running.length ? "warning" : cancelled.length ? "muted" : "success";
        const total = `${calls.length} call${calls.length === 1 ? "" : "s"}`;
        const names = [...new Set(calls.map(c => shortName(c.name || "tool")))];
        let summary = names.slice(0, 2).join(", ");
        if (names.length > 2) summary += ` +${names.length - 2} types`;
        const duration = /Wall time ([\d.]+) seconds/.exec(header)?.[1];
        let line = `${icon} ${total}${summary ? ` · ${summary}` : ""}${duration ? ` · ${duration}s` : ""}`;
        if (failed.length) line += ` · ${failed.length} failed`;
        if (cancelled.length) line += ` · ${cancelled.length} cancelled`;
        if (error) {
          const nestedError = failed.find(c => c.error)?.error;
          const texts = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
          const scriptError = /Script error:\s*\n([^\n]+)/.exec(texts)?.[1];
          const detail = nestedError || scriptError;
          if (detail) line += ` · ${clean(detail).slice(0, 100)}`;
          else line += " · expand for error details";
        } else if (!options.isPartial) {
          line += result.details?.fullOutputPath ? " · full output saved" : " · output hidden";
        }
        return singleLine(theme.fg(color, line), theme, { ...context, isError: error, isPartial: options.isPartial });
      },
    });
  });
}
