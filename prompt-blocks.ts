import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
type SlashCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
/** stdout.rows is the current terminal/tmux pane; non-TTY fallback is 24.
 * Reserve 8 rows for summary/footer/separator/editor chrome. */
export function paneBodyHeight(preference: number | "auto", rows = process.stdout.rows): number {
  const terminalRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  const adaptive = Math.max(1, Math.min(Math.floor(terminalRows * .45), terminalRows - 8));
  return preference === "auto" ? adaptive : Math.max(1, Math.min(preference, adaptive));
}

type Mode = "quiet" | "compact" | "expanded";
type Template = { name: string; parts: string[] };
const commandDescription = "Block controls menu; help, display modes, pane navigation, height, frame/highlight";
const ownerPath = fileURLToPath(new URL("./index.ts", import.meta.url));
/** This host version dispatches extension commands before any agent/input path.
 * Missing/foreign commands or unsupported host versions must fail closed. */
export function canDispatchBlockMode(pi: Pick<ExtensionAPI, "getCommands" | "sendUserMessage">, version = VERSION) {
  if (version !== "1.1.0" || typeof pi.sendUserMessage !== "function") return false;
  try { return pi.getCommands().some(c => c.name === "blocks" && c.source === "extension" && c.description === commandDescription && c.sourceInfo?.path === ownerPath); }
  catch { return false; }
}
const placeholders = /\$\{(?:\d+|ARGUMENTS|@):-[^}]*\}|\$\{@:\d+(?::\d+)?\}|\$(?:ARGUMENTS|@|\d+)/g;

export function templateMatchers(commands: SlashCommandInfo[]): Template[] {
  const templates: Template[] = [];
  for (const command of commands) {
    if (command.source !== "prompt") continue;
    // Follow Pi's command precedence: extension commands take priority over templates.
    if (commands.some(other => other.source === "extension" && other.name === command.name)) continue;
    try {
      const raw = readFileSync(command.sourceInfo.path, "utf8");
      if (raw.length > 100000) continue;
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
      const parts = body.split(placeholders);
      // Require a distinctive fixed prefix. Dynamic-only/short prompts stay visible.
      if (parts[0].length < 40 || parts.length > 33) continue;
      templates.push({ name: command.name, parts });
    } catch { /* Resource missing/changed: leave its messages fully visible. */ }
  }
  return templates;
}

export function matchingTemplate(text: string, templates: Template[]): string | undefined {
  const value = text.trim();
  if (value.length > 200000) return undefined;
  for (const { name, parts } of templates) {
    if (parts.length === 1) {
      if (value === parts[0]) return name;
      continue;
    }
    // Trim at the outer message edges only. No regex wildcards/backtracking over large prompts.
    const first = parts[0].trimStart();
    const last = parts.at(-1)!.trimEnd();
    if (!value.startsWith(first.trimEnd()) || (last && !value.endsWith(last))) continue;
    let position = Math.min(first.length, value.length);
    let matches = true;
    for (const part of parts.slice(1, -1)) {
      const next = value.indexOf(part, position);
      if (next < 0) { matches = false; break; }
      position = next + part.length;
    }
    if (matches && (!last || position <= value.length - last.length)) return name;
  }
  return undefined;
}

export default function registerPromptBlocks(pi: ExtensionAPI, paneAction: (action: string) => boolean = () => false, paneState: () => { kind?: string; label?: string; scrollable?: boolean; available: boolean; open: boolean; raw: boolean; actions: readonly { row: number; label: string }[] } = () => ({ available: false, open: false, raw: false, actions: [] }), thinkingControls?: { state: () => { available: boolean; open: boolean; rounds: number }; action: (action: string) => boolean }) {
  const configPath = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "compact-tool-renderers.json");
  let mode: Mode = "quiet";
  let paneHeight: number | "auto" = "auto";
  let frame = true, bodyHighlight = true;
  let savedSettings: Record<string, unknown> = {};
  let currentContext: any;
  let contextEpoch = 0;
  let notifyCurrent: ((message: string, type: "error") => void) | undefined;
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t\x1b]/g, " ").slice(0, 300);
  type Dispatch = { dispatch: Mode; epoch: number };
  const feedback = async (ctx: any, message: string) => { await ctx.ui.select(message, ["Back"]); };
  const persist = (nextMode = mode) => {
    mkdirSync(dirname(configPath), { recursive: true });
    const temp = `${configPath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...savedSettings, mode: nextMode, paneHeight, frame, bodyHighlight }, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, configPath);
  };
  try {
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    savedSettings = saved;
    if (typeof saved.frame === "boolean") frame = saved.frame;
    if (typeof saved.bodyHighlight === "boolean") bodyHighlight = saved.bodyHighlight;
    if (Number.isInteger(saved.paneHeight) && saved.paneHeight >= 1 && saved.paneHeight <= 200) paneHeight = saved.paneHeight;
    if (["quiet", "compact", "expanded"].includes(saved.mode)) mode = saved.mode;
  } catch { /* Default is quiet; this file contains UI preferences only. */ }
  let templates: Template[] = [];
  const refresh = (_event: unknown, ctx: ExtensionContext) => {
    currentContext = ctx;
    contextEpoch++;
    // Capture the host method while valid; never read revoked context getters in feedback.
    const ui = ctx.ui;
    notifyCurrent = typeof ui.notify === "function" ? ui.notify.bind(ui) : undefined;
    templates = templateMatchers(pi.getCommands());
    if (ctx.mode === "tui") ctx.ui.setToolsExpanded(mode === "expanded");
  };
  pi.on("session_start", refresh);
  pi.on("session_switch", refresh);
  pi.registerMarkdownTransformer((markdown, context) => {
    if (mode === "expanded" || context.messageType !== "user") return markdown;
    const name = matchingTemplate(markdown, templates);
    if (!name) return markdown;
    // Text is replaced only at rendering time. The stored/model-facing message is untouched.
    const label = name.replace(/[\\`*_\[\]<>]/g, "");
    return `**prompt** · /${label} · /blocks expanded for instructions`;
  });
  const help = "/blocks (or menu): native controls. /blocks quiet|compact|expanded (idle-only reload; tool, template and topic previews are coupled by mode; tools/skills expansion is coupled by Pi). /blocks open|open latest|close|raw; scroll up|down|page-up|page-down|home|end; previous|next|jump [ordinal]; height auto|1..200; thinking open|close|up|down|page-up|page-down|home|end (grouped in quiet mode, native Ctrl+T still shows original rounds); frame on|off; body-highlight on|off; status|help. Frame/highlight apply immediately; raw/open/scroll are transient. Ctrl+O tools/skills, Ctrl+T original thinking.";
  const execute = async (args: string, ctx: any): Promise<boolean | void | Dispatch> => {
      const action = args.trim() || "menu";
      if (action === "menu") return await menu(ctx);
      if (action === "help") { ctx.ui.notify(help, "info"); return false; }
      const [verb, value] = action.split(/\s+/);
      if (verb === "thinking") {
        if (!["open", "close", "up", "down", "page-up", "page-down", "home", "end"].includes(value)) { ctx.ui.notify("Usage: /blocks thinking open|close|up|down|page-up|page-down|home|end", "warning"); return false; }
        if (!thinkingControls?.action(value)) ctx.ui.notify("No available grouped thinking pane. Use quiet mode with native thinking hidden (Ctrl+T); open it before scrolling.", "info");
        return false;
      }
      if (["frame", "body-highlight"].includes(verb)) {
        if (!["on", "off"].includes(value)) { ctx.ui.notify(`Usage: /blocks ${verb} on|off`, "warning"); return false; }
        if (verb === "frame") frame = value === "on"; else bodyHighlight = value === "on";
        persist(); paneAction("refresh"); thinkingControls?.action("refresh"); return false;
      }
      if (verb === "jump") {
        const state = paneState();
        if (!state.open || !state.actions.length) { ctx.ui.notify("No active recorded-call pane to jump in.", "info"); return false; }
        let ordinal = Number(value);
        if (!value) {
          if (ctx.mode !== "tui" || typeof ctx.ui.select !== "function") { ctx.ui.notify("Use /blocks jump <ordinal> in this mode.", "info"); return false; }
          const options = state.actions.map((a, i) => `${i + 1}. ${a.label}`);
          const epoch = contextEpoch;
          const selected = await ctx.ui.select("Jump to recorded call", options);
          // A dialog can outlive reload or a click selecting another pane. Navigation
          // arrays are cached per pane/revision; reject changed anchors conservatively.
          if (epoch !== contextEpoch || !currentContext) return false;
          const active = paneState();
          if (!active.open || active.actions !== state.actions) return false;
          if (!selected) return false;
          ordinal = options.indexOf(selected) + 1;
        }
        if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > state.actions.length) { ctx.ui.notify(`Choose a call ordinal 1..${state.actions.length}.`, "warning"); return false; }
        paneAction(`jump ${ordinal}`); return false;
      }
      if (verb === "raw" && value === "latest-question") {
        if (!paneAction("raw latest-question")) ctx.ui.notify("Expand a question first with Ctrl+O or its header; no eligible expanded question in this branch.", "info");
        return false;
      }
      if (["scroll", "open", "close", "raw", "height", "previous", "next"].includes(verb)) {
        if (verb === "height") {
          const n = value === "auto" ? "auto" : Number(value);
          if (n !== "auto" && (!Number.isInteger(n) || n < 1 || n > 200)) { ctx.ui.notify("Usage: /blocks height auto | 1..200 (max rows, terminal-adaptive)", "warning"); return; }
          paneHeight = n;
          persist();
          paneAction("refresh");
          thinkingControls?.action("refresh");
          ctx.ui.notify(`Tool pane height: ${paneHeight}; current body cap ${paneBodyHeight(paneHeight)} rows. No reload needed.`, "info");
          return;
        }
        if (verb === "scroll" && !["up", "down", "page-up", "page-down", "home", "end"].includes(value)) { ctx.ui.notify("Usage: /blocks scroll up|down|page-up|page-down|home|end", "warning"); return; }
        if (["previous", "next"].includes(verb) && (!paneState().open || !paneState().actions.length)) { ctx.ui.notify("No active recorded-call pane to navigate.", "info"); return false; }
        const report = paneState().kind === "report";
        const acted = paneAction(verb === "scroll" ? value : verb === "open" && value === "latest" ? "open latest" : verb);
        if (acted && verb === "close" && !report) ctx.ui.setToolsExpanded(false); // Tool global collapse; report close is its own public setter.
        if (!acted) ctx.ui.notify(report ? "No active bounded report pane for this action. Expanded display mode uses transcript scrolling; open the report for Raw/Close." : "No active tool pane. Use /blocks open in quiet mode, or click a grouped summary.", "info");
        return;
      }
      if (action === "status") {
        ctx.ui.notify(`Block preference: ${mode}; frame ${frame ? "on" : "off"}; body highlight ${bodyHighlight ? "on" : "off"}; pane height ${paneHeight} (effective ${paneBodyHeight(paneHeight)}); tools/skills currently ${ctx.ui.getToolsExpanded() ? "expanded" : "collapsed"}. ${templates.length} long prompt templates recognized. Ctrl+O opens bounded tool details/skills; /blocks expanded is the unbounded tool escape. /blocks quiet groups routine calls; compact restores the colored two-row display; expanded reveals templates too.`, "info");
        return;
      }
      if (!["quiet", "compact", "expanded"].includes(action)) {
        ctx.ui.notify(help, "warning");
        return;
      }
      const childCounter = (globalThis as any)[Symbol.for("pi-subagents/running-children-count")];
      if (!ctx.isIdle() || (typeof childCounter === "function" && childCounter() > 0)) {
        ctx.ui.notify("Wait until the current turn and subagents finish before changing block mode; it reloads the display runtime.", "warning");
        return;
      }
      if (typeof ctx.reload !== "function") {
        if (!canDispatchBlockMode(pi)) { ctx.ui.notify("Display-mode dispatch unavailable: supported Pi host and this package's registered /blocks command are required. No model request was sent.", "warning"); return false; }
        return { dispatch: action as Mode, epoch: contextEpoch };
      }
      // Persist only a UI setting. Reload refreshes ordinary user Markdown caches as well as tools.
      persist(action as Mode);
      ctx.ui.setToolsExpanded(action === "expanded");
      const reloadEpoch = contextEpoch, reloadContext = currentContext;
      currentContext = undefined;
      try { await ctx.reload(); }
      catch (error) {
        if (reloadEpoch === contextEpoch) { currentContext = reloadContext; persist(mode); }
        throw error;
      }
      // Reload replaces this runtime; leave the menu without using old ctx/pi.
      return true;
  };
  const menu = async (ctx: any): Promise<boolean | void | Dispatch> => {
    if (ctx.mode !== "tui" || typeof ctx.ui.select !== "function") { ctx.ui.notify(help, "info"); return; }
    type Page = "root" | "tools" | "thinking" | "appearance" | "mode" | "help" | "tool-scroll" | "thinking-scroll" | "height" | "help-page" | "status-page";
    const epoch = contextEpoch;
    let page: Page = "root";
    const directions = ["up", "down", "page-up", "page-down", "home", "end"];
    while (true) {
      if (epoch !== contextEpoch || !currentContext) return;
      const state = paneState(), thought = thinkingControls?.state();
      const report = state.kind === "report";
      const detailLabel = report ? state.label?.startsWith("Question ·") ? "Question" : "Report" : "Tools";
      const toolsAvailable = (mode === "quiet" || report) && (state.available || state.open);
      const toolStatus = !toolsAvailable ? "unavailable" : state.open ? `open · ${state.raw ? "raw" : "readable"}` : "closed";
      const thoughtStatus = thought?.available ? `${thought.rounds} rounds · ${thought.open ? "open" : "closed"}` : "unavailable";
      let title: string, options: [string, string][];
      if (page === "root") {
        title = "Block controls";
        options = [[`${detailLabel}… ${toolStatus}`, "@tools"], [`Thinking… ${thoughtStatus}`, "@thinking"], [`Appearance… frame ${frame ? "on" : "off"} · bg ${bodyHighlight ? "on" : "off"}`, "@appearance"], [`Display mode… ${mode}`, "@mode"], ["Help & status…", "@help"], ["Done", "done"]];
      } else if (page === "tools") {
        title = `${report ? state.label || "Report" : "Tools"} · ${toolStatus}${!toolsAvailable ? " (quiet + recorded tools required)" : ""}`;
        options = toolsAvailable ? [[state.open ? "Close pane" : report ? "Open report pane" : "Open latest pane", state.open ? "close" : "open"]] : [];
        if (toolsAvailable && state.open) {
          if (state.actions.length) options.push(["Previous call / current heading", "previous"], ["Next call", "next"], ["Jump to call…", "jump"]);
          if (state.scrollable !== false) options.push(["Scroll…", "@tool-scroll"]);
          if (report) options.push([`${detailLabel} output: ${state.raw ? "raw" : "readable"}`, "raw"]);
        }
        options.push(["Back", "@root"]);
      } else if (page === "thinking") {
        title = `Thinking · ${thoughtStatus}${!thought?.available ? " (quiet + native hidden thinking required)" : ""}`;
        options = thought?.available ? [[thought.open ? "Close pane" : "Open pane", `thinking ${thought.open ? "close" : "open"}`]] : [];
        if (thought?.available && thought.open) options.push(["Scroll…", "@thinking-scroll"]);
        options.push(["Back", "@root"]);
      } else if (page === "appearance") {
        title = "Appearance · changes apply immediately";
        options = [[`Height… ${paneHeight} · cap ${paneBodyHeight(paneHeight)} rows`, "@height"], [`Outer frame: ${frame ? "on" : "off"}`, `frame ${frame ? "off" : "on"}`], [`Body background: ${bodyHighlight ? "on" : "off"}`, `body-highlight ${bodyHighlight ? "off" : "on"}`]];
        if (toolsAvailable && state.open) options.push([`${report ? detailLabel : "Tool"} output: ${state.raw ? "raw" : "readable"}`, "raw"]);
        options.push(["Back", "@root"]);
      } else if (page === "mode") {
        title = "Display mode · idle-only reload (tools/templates/topics coupled)";
        options = [[`${mode === "quiet" ? "✓ " : ""}Quiet · grouped`, "quiet"], [`${mode === "compact" ? "✓ " : ""}Compact · per-call`, "compact"], [`${mode === "expanded" ? "✓ " : ""}Expanded · full details`, "expanded"], ["Back", "@root"]];
      } else if (page === "help") {
        title = "Help & status";
        options = [["Help · all typed options", "help"], ["Status", "status"], ["Back", "@root"]];
      } else if (page === "help-page") {
        title = "Help · controls and keyboard paths";
        options = [["Details: tools, reports, questions · open/close · Raw · scroll", "info"], ["Thinking: open/close · scroll (quiet + Ctrl+T hidden)", "info"], ["Appearance: height · frame · background · readable/raw", "info"], ["Display: quiet grouped · compact per-call · expanded full", "info"], ["Mode changes reload; tools/templates/topics are coupled", "info"], ["Keyboard: arrows + Enter in menus; Escape returns root", "info"], ["Ctrl+O: tools/skills · Ctrl+T: original thinking", "info"], ["No dedicated Previous/Next/Jump keys; /blocks help lists commands", "info"], ["Back", "@help"]];
      } else if (page === "status-page") {
        title = "Status · current display state";
        options = [[`Mode: ${mode}`, "info"], [`Outer frame: ${frame ? "on" : "off"}`, "info"], [`Body background: ${bodyHighlight ? "on" : "off"}`, "info"], [`Height: ${paneHeight} · adaptive 45% · cap ${paneBodyHeight(paneHeight)} rows`, "info"], [report ? `${detailLabel} pane: ${toolStatus}${state.scrollable === false ? " · unbounded" : " · bounded"}` : `Tool pane: ${toolStatus} · ${state.actions.length} cached calls`, "info"], [`Thinking: ${thoughtStatus}`, "info"], [`Native tools/skills: ${ctx.ui.getToolsExpanded() ? "expanded" : "collapsed"}`, "info"], [`Recognized templates: ${templates.length}`, "info"], ["Back", "@help"]];
      } else if (page === "height") {
        title = `Height · ${paneHeight} · adaptive 45% (cap ${paneBodyHeight(paneHeight)})`;
        options = ["auto", "1", "3", "5", "9", "15", "20", "50", "100", "200"].map(n => [n, `height ${n}`]);
        options.push(["Back", "@appearance"]);
      } else {
        const tool = page === "tool-scroll";
        const available = tool ? toolsAvailable && state.open && state.scrollable !== false : !!thought?.available && thought.open;
        title = `${tool ? report ? "Report" : "Tool" : "Thinking"} scroll${available ? "" : " · pane closed"}`;
        options = available ? directions.map(a => [a, `${tool ? "scroll" : "thinking"} ${a}`]) : [];
        options.push(["Back", tool ? "@tools" : "@thinking"]);
      }
      const choice = await ctx.ui.select(title, options.map(o => o[0]));
      if (epoch !== contextEpoch || !currentContext) return;
      if (!choice) { if (page === "root") return; page = "root"; continue; }
      const action = options.find(o => o[0] === choice)?.[1];
      if (!action || action === "done") return;
      if (action.startsWith("@")) { page = action.slice(1) as Page; continue; }
      if (action === "info") continue;
      if (action === "help" || action === "status") { page = action === "help" ? "help-page" : "status-page"; continue; }
      // Keep action feedback inside the dialog, not hidden transcript notifications.
      const notices: string[] = [];
      const actionContext = { ...ctx, ui: { ...ctx.ui, notify: (message: string) => { if (!message.startsWith("Tool pane height:")) notices.push(message); } } };
      let result: boolean | void | Dispatch = undefined;
      try { result = await execute(action, actionContext); }
      catch (error) { notices.push(`Could not apply option: ${error instanceof Error ? error.message : String(error)}`); }
      if (result) return result; // direct reload or fresh-command dispatch exits every menu
      if (epoch !== contextEpoch || !currentContext) return;
      if (notices.length) await feedback(ctx, notices.join("\n"));
      if (page === "height") page = "appearance";
    }
  };
  const completions = ["menu", "help", "status", "quiet", "compact", "expanded", "open", "open latest", "close", "raw", "raw latest-question", "previous", "next", "jump", "height auto", "height 1", "height 5", "height 20", "frame on", "frame off", "body-highlight on", "body-highlight off", ...["open", "close", "up", "down", "page-up", "page-down", "home", "end"].map(a => `thinking ${a}`), ...["up", "down", "page-up", "page-down", "home", "end"].map(a => `scroll ${a}`)];
  pi.registerCommand("blocks", {
    description: commandDescription,
    getArgumentCompletions: prefix => completions.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => { currentContext = ctx; await run(args, ctx); },
  });
  const run = async (action: string, ctx: any) => {
    const result = await execute(action, ctx); // menu is fully closed before dispatch
    if (!result || typeof result !== "object") return;
    if (result.epoch !== contextEpoch || !currentContext) return;
    const childCounter = (globalThis as any)[Symbol.for("pi-subagents/running-children-count")];
    if (!ctx.isIdle() || typeof childCounter === "function" && childCounter() > 0 || !canDispatchBlockMode(pi)) {
      if (ctx.mode === "tui" && typeof ctx.ui.select === "function") await feedback(ctx, "Display-mode change unavailable or busy. No dispatch/model request was sent.");
      return;
    }
    // Exact whitelist only; the registered handler receives a fresh command ctx
    // and repeats idle/child guards. Never send ordinary prompt/history content.
    try { pi.sendUserMessage(`/blocks ${result.dispatch}`, { expandPromptTemplates: true }); }
    catch (error) {
      if (result.epoch === contextEpoch && currentContext && ctx.mode === "tui" && typeof ctx.ui.select === "function") await feedback(ctx, `Could not dispatch display-mode change: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  pi.on("session_shutdown", () => { currentContext = undefined; notifyCurrent = undefined; contextEpoch++; });
  return { getMode: () => mode, getPaneHeight: () => paneBodyHeight(paneHeight), getPaneStyle: () => ({ frame, bodyHighlight }), control: async (action: string) => {
    if (!currentContext) return;
    const epoch = contextEpoch;
    try { await run(action, currentContext); }
    catch (error) {
      // Only this fire-and-forget UI boundary owns failures. Awaited commands still
      // propagate to Pi. Disposed interactions cannot report through a successor.
      if (epoch !== contextEpoch || !currentContext) return;
      const message = `Could not apply block control: ${errorText(error)}`;
      try {
        if (!notifyCurrent) throw new Error("Current UI feedback unavailable");
        await notifyCurrent(message, "error");
      } catch (feedbackError) {
        // No recursive dialog or dropped I/O failure if the host feedback also fails.
        console.error(`${message}; feedback failed: ${errorText(feedbackError)}`);
      }
    }
  } };
}
