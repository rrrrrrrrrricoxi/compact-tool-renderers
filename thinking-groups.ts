import { Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { GroupPane } from "./group-pane.ts";
import { thinkingTopic } from "./thinking-preview.ts";

type Record = { message: any; component?: any; trusted?: boolean; textRefs?: string[]; kind: "boundary" | "bridge" | "round"; hidden?: boolean; group?: Group };
type Group = { members: Record[]; pane?: GroupPane; revision: number; activeVersion?: number; activeMode?: string; activeValue?: boolean };
const thinking = (message: any) => (message?.content || []).filter((b: any) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim());
const safe = (message: any) => message?.role === "assistant" && !["error", "aborted", "length"].includes(message.stopReason) && !(message.content || []).some((b: any) => b.type === "text" && b.text?.trim() || b.type === "toolCall" && b.name === "ask_user_question");
const kind = (message: any): Record["kind"] => !safe(message) ? "boundary" : thinking(message).length ? "round" : "bridge";
const boundary = (message: any) => message?.role === "assistant" ? !safe(message) : message?.role === "toolResult" ? !!message.isError || message.toolName === "ask_user_question" : message?.role !== "system" && !(message?.role === "custom" && message.display === false);

/** Original branch refs + ordered public streaming events only. No timestamps,
 * content matching, transcript-root traversal, or retained full-text copies. */
export class ThinkingGroups {
  private items: (Record | null)[] = [];
  private aliases = new WeakMap<object, Record>();
  private components = new WeakMap<object, Record>();
  private boundaries = new WeakSet<object>();
  private live?: Record;
  private lastFinalized?: Record;
  private groups = new Map<Record, Group>();
  private activeGroup?: Group;
  private dirty = false;
  private visibilityVersion = 0;
  constructor(private theme: () => any, private mode: () => string, private height: () => number, private style: () => { frame: boolean; bodyHighlight: boolean }) {}
  clear() {
    this.items = []; this.aliases = new WeakMap(); this.components = new WeakMap(); this.boundaries = new WeakSet();
    this.live = undefined; this.lastFinalized = undefined; this.activeGroup = undefined; this.groups.clear(); this.dirty = false; this.visibilityVersion++;
  }
  rebuild(entries: readonly any[]) {
    this.clear();
    for (const entry of entries) {
      if (entry.type === "message") this.observe("end", entry.message);
      else if (["compaction", "branch_summary"].includes(entry.type) || entry.type === "custom_message" && entry.display !== false) { this.items.push(null); this.dirty = true; }
    }
    // observe marks dirtiness only: one membership pass for the whole branch.
    this.regroup();
  }
  observe(phase: "start" | "update" | "end", message: any) {
    if (!message || typeof message !== "object") return;
    if (message.role !== "assistant") {
      if (boundary(message) && !this.boundaries.has(message)) { this.items.push(null); this.boundaries.add(message); this.live = undefined; this.dirty = true; }
      return;
    }
    let record = this.aliases.get(message);
    if (!record && phase !== "start") record = this.live;
    if (!record) { record = { message, kind: kind(message) }; this.items.push(record); this.dirty = true; }
    record.message = message;
    this.aliases.set(message, record);
    this.refresh(record);
    this.live = phase === "end" ? undefined : record;
    if (phase === "end") this.lastFinalized = record;
  }
  private hidden(record: Record) {
    const c = record.component;
    return record.trusted === true && c && this.aliases.get(c.lastMessage) === record && this.components.get(c) === record && Array.isArray(c.contentContainer?.children) && c.hideThinkingBlock === true && c.thinkingVisibilityOverrides instanceof Map && c.contentContainer.children.every((child: any) => child instanceof Spacer || child instanceof MouseRegion) && ![...c.thinkingVisibilityOverrides.values()].some(v => v === false);
  }
  private refresh(record: Record) {
    const blocks = thinking(record.message);
    const refs = record.textRefs;
    if (!refs || refs.length !== blocks.length || blocks.some((b: any, i: number) => b.thinking !== refs[i])) {
      // String references only; no concatenation/normalization/full-text copy.
      record.textRefs = blocks.map((b: any) => b.thinking);
      if (record.group) record.group.revision++;
    }
    const next = !safe(record.message) ? "boundary" : blocks.length ? "round" : "bridge";
    if (next !== record.kind) { record.kind = next; this.dirty = true; }
    const hidden = !!this.hidden(record);
    if (hidden !== record.hidden) { record.hidden = hidden; this.visibilityVersion++; }
  }
  associate(component: any, message: any, trusted = false) {
    const previous = this.components.get(component);
    const record = this.aliases.get(message);
    if (previous && previous !== record) { previous.component = undefined; previous.trusted = false; this.refresh(previous); this.components.delete(component); }
    if (record) {
      if (record.component && record.component !== component) this.components.delete(record.component);
      record.component = component; record.trusted = trusted; this.components.set(component, record); this.refresh(record);
    }
  }
  private regroup() {
    if (!this.dirty) return;
    this.dirty = false; this.visibilityVersion++;
    let members: Record[] = [];
    const used = new Set<Record>();
    const flush = () => {
      if (!members.length) return;
      const key = members[0]; used.add(key);
      const group = this.groups.get(key) || { members: [], revision: 0 };
      group.members = members; group.revision++;
      this.groups.set(key, group);
      for (const member of members) member.group = group;
      members = [];
    };
    for (const record of this.items) {
      if (record) record.group = undefined;
      if (!record || record.kind === "boundary") flush();
      else if (record.kind === "round") members.push(record);
    }
    flush();
    for (const key of this.groups.keys()) if (!used.has(key)) this.groups.delete(key);
    if (this.activeGroup && ![...this.groups.values()].includes(this.activeGroup)) this.activeGroup = undefined;
  }
  private prepare(record?: Record) {
    // Extension message_end precedes core/UI finalization. Check that one record,
    // plus the currently rendered/associated record, not the entire history.
    if (this.lastFinalized) this.refresh(this.lastFinalized);
    if (record && record !== this.lastFinalized) this.refresh(record);
    this.regroup();
  }
  private active(group?: Group) {
    if (!group) return false;
    const mode = this.mode();
    if (group.activeVersion !== this.visibilityVersion || group.activeMode !== mode) {
      group.activeValue = mode === "quiet" && group.members.every(r => r.kind === "round" && r.hidden === true);
      group.activeVersion = this.visibilityVersion; group.activeMode = mode;
    }
    return group.activeValue === true;
  }
  groupFor(component: any) {
    const record = this.aliases.get(component.lastMessage);
    this.prepare(record);
    return record && this.components.get(component) === record && record.component === component && this.active(record.group) ? { record, group: record.group! } : undefined;
  }
  interact(group: Group) { if (this.active(group)) this.activeGroup = group; }
  private target() {
    this.prepare();
    if (this.active(this.activeGroup)) return this.activeGroup;
    this.activeGroup = undefined;
    return [...this.groups.values()].reverse().find(g => this.active(g));
  }
  pane(group: Group) {
    group.pane ||= new GroupPane(() => {
      const last = group.members.at(-1)!;
      const topic = thinkingTopic(thinking(last.message)[0]?.thinking || "");
      return `Thinking · ${group.members.length} round${group.members.length === 1 ? "" : "s"}${topic ? ` · ${topic}` : ""}`;
    }, width => {
      const rows: string[] = [];
      group.members.forEach((r, i) => {
        rows.push(...new Text(this.theme().fg("muted", `Round ${i + 1}/${group.members.length}`), 0, 0).render(width));
        let run: string[] = [];
        const flush = () => {
          if (run.length) rows.push(...new Markdown(run.join("\n\n"), 0, 0, r.component.markdownTheme ?? getMarkdownTheme(), { color: (text: string) => this.theme().fg("thinkingText", text), italic: true }).render(width));
          run = [];
        };
        for (const block of r.message.content) {
          if (block.type === "thinking") { if (typeof block.thinking === "string" && block.thinking.trim()) run.push(block.thinking); }
          else flush();
        }
        flush();
      });
      return rows;
    }, this.height, this.theme, () => {}, () => group.revision, this.style);
    group.pane.footerControls = width => width >= 30 ? [["[↑]", "up"], ["[↓]", "down"], ["[Pg↑]", "page-up"], ["[Pg↓]", "page-down"], ["[Close]", "close"]] : width >= 16 ? [["[Close]", "close"], ["[↑]", "page-up"], ["[↓]", "page-down"]] : [["×", "close"], ["↑", "page-up"], ["↓", "page-down"]];
    group.pane.onControl = action => { this.interact(group); group.pane!.action(action); };
    return group.pane;
  }
  action(action: string) {
    const group = this.target();
    if (!group) return false;
    if (action === "refresh") return true;
    const pane = this.pane(group);
    if (action === "open") { pane.open = true; this.activeGroup = group; }
    else if (action === "close") pane.open = false;
    else if (["up", "down", "page-up", "page-down", "home", "end"].includes(action)) { if (!pane.isOpen) return false; pane.action(action); }
    else return false;
    return true;
  }
  state() {
    const group = this.target();
    return { available: !!group, open: !!group?.pane?.isOpen, rounds: group?.members.length || 0 };
  }
}
