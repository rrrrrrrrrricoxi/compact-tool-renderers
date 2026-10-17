import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { installModernPromptAdapter, invalidateModernPrompt } from "./modern-prompts-adapter.ts";

type Mode = { isEnabled(): boolean; onChange(callback: () => void): () => void };
type Template = { name: string; parts: string[] };
type PromptCard = { component: any; original: string; name: string; open: boolean; revision: number };
const placeholders = /\$\{(?:\d+|ARGUMENTS|@):-[^}]*\}|\$\{@:\d+(?::\d+)?\}|\$(?:ARGUMENTS|@|\d+)/g;
export function modernPromptTemplates(commands: readonly any[]): Template[] {
  const templates: Template[] = [];
  for (const command of commands) {
    if (command.source !== "prompt" || commands.some(c => c.source === "extension" && c.name === command.name)) continue;
    try {
      const raw = readFileSync(command.sourceInfo.path, "utf8");
      if (raw.length > 100000) continue;
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
      const parts = body.split(placeholders);
      if (parts[0].length >= 40 && parts.length <= 33) templates.push({ name: command.name, parts });
    } catch { /* Missing templates leave their original text visible. */ }
  }
  return templates;
}
export function matchingModernPrompt(text: string, templates: readonly Template[]): string | undefined {
  const value = text.trim();
  if (value.length > 200000) return;
  for (const { name, parts } of templates) {
    if (parts.length === 1) { if (value === parts[0]) return name; continue; }
    const first = parts[0].trimStart(), last = parts.at(-1)!.trimEnd();
    if (!value.startsWith(first) || last && !value.endsWith(last)) continue;
    let position = first.length, matches = true;
    for (const part of parts.slice(1, -1)) {
      const next = value.indexOf(part, position);
      if (next < 0) { matches = false; break; }
      position = next + part.length;
    }
    if (matches && (!last || position <= value.length - last.length)) return name;
  }
}

/** Display only: the public transformer sees the original Markdown. Its output
 * does not replace messages, prompt expansion, transcript entries, or model input. */
export function registerModernPrompts(pi: ExtensionAPI, mode: Mode): () => void {
  const owner = Symbol.for("compact-renderer:prompt-registration:v1"), shared = globalThis as any;
  shared[owner]?.();
  let templates: Template[] = [], cards = new Map<any, PromptCard>();
  let rendering: PromptCard | undefined, selected: PromptCard | undefined;
  let focused = false, active = false, disposed = false, revision = 0, redraw: (() => void) | undefined, input: (() => void) | undefined;
  const invalidate = () => { for (const card of cards.values()) invalidateModernPrompt(card.component); };
  const release = () => { if (focused) { focused = false; revision++; } };
  const select = (card: PromptCard) => { selected = card; focused = true; pi.events.emit("compact-renderer:focus:v1", { owner: "prompts" }); };
  const adapter = installModernPromptAdapter({
    render(component, markdown, original) {
      if (disposed || !active) return original();
      const name = matchingModernPrompt(markdown, templates);
      let card = cards.get(component);
      if (!name) { if (card) { invalidateModernPrompt(component); cards.delete(component); } return original(); }
      if (!card) { card = { component, original: markdown, name, open: false, revision: -1 }; cards.set(component, card); }
      if (card.original !== markdown) { card.original = markdown; card.open = false; card.revision = -1; }
      if (card.revision !== revision || card.name !== name) { invalidateModernPrompt(component); card.revision = revision; card.name = name; }
      const previous = rendering;
      rendering = card;
      try { return original(); } finally { rendering = previous; }
    },
    fallback(component) { cards.delete(component); if (selected?.component === component) { selected = undefined; release(); } },
    mouse(component, event) {
      const card = cards.get(component);
      if (!disposed && active && mode.isEnabled() && card && event.type === "click" && event.button === "left" && event.y === 1) {
        select(card); card.open = !card.open; revision++; return { handled: true, render: true };
      }
    },
  });
  // No usable inline adapter means no collapse. Unsupported hosts show originals.
  pi.registerMarkdownTransformer((markdown, context) => {
    if (disposed || !active || !adapter || !mode.isEnabled() || context.messageType !== "user" || !rendering || markdown !== rendering.original) return markdown;
    const label = rendering.name.replace(/[\\`*_\[\]<>\p{Cc}\p{Cf}]/gu, "");
    const heading = `**${rendering.open ? "▾" : "▸"} prompt · /${label}** · ${focused && selected === rendering ? "Esc releases · " : "Alt+I focuses · "}Enter ${rendering.open ? "collapses" : "expands"}`;
    return rendering.open ? `${heading}\n\n${markdown}` : heading;
  });
  const reset = (_event: unknown, ctx: any) => {
    invalidate(); cards.clear(); rendering = undefined; selected = undefined; focused = false; revision++;
    input?.(); input = undefined; redraw = undefined; active = false;
    if (disposed) return;
    templates = modernPromptTemplates(pi.getCommands());
    if (ctx.mode !== "tui" || !adapter) return;
    active = true;
    const ui = ctx.ui;
    redraw = typeof ui.setHiddenThinkingLabel === "function" ? () => ui.setHiddenThinkingLabel() : undefined;
    input = ui.onTerminalInput?.((data: string) => {
      if (!mode.isEnabled()) { release(); return; }
      if (matchesKey(data, "alt+i")) {
        const choices = [...cards.values()];
        if (!choices.length) return;
        const index = focused ? choices.indexOf(selected!) : -1;
        select(index < 0 ? choices.at(-1)! : choices[(index + choices.length - 1) % choices.length]);
        // Focus appears in the same short label on the next render.
        revision++; redraw?.(); return { consume: true };
      }
      if (!focused || !selected || !cards.has(selected.component)) return;
      if (matchesKey(data, "escape")) { release(); redraw?.(); return { consume: true }; }
      if (matchesKey(data, "enter")) { selected.open = !selected.open; revision++; redraw?.(); return { consume: true }; }
    });
    redraw?.();
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ["session_start", "session_tree", "session_compact"] as const) subscriptions.push(pi.on(event, reset));
  subscriptions.push(pi.on("ui_prompt_start", release));
  subscriptions.push(pi.on("session_shutdown", () => { active = false; invalidate(); input?.(); input = undefined; redraw = undefined; cards.clear(); selected = undefined; rendering = undefined; release(); }));
  subscriptions.push(pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "prompts") release(); }));
  subscriptions.push(mode.onChange(() => { revision++; release(); invalidate(); redraw?.(); }));
  const dispose = () => { if (disposed) return; disposed = true; active = false; for (const unsub of subscriptions) unsub?.(); input?.(); input = undefined; invalidate(); cards.clear(); adapter?.(); redraw?.(); redraw = undefined; release(); if (shared[owner] === dispose) delete shared[owner]; };
  shared[owner] = dispose;
  return dispose;
}
