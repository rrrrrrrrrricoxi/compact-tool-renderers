import type { PaneContent } from "./modern-tool-pane.ts";

const scalar = (value: any) => value === undefined ? "undefined" : typeof value === "bigint" ? `${value}n` : JSON.stringify(value) ?? String(value);

/** Local field names keep structure readable without constructing a serialized payload.
 * Strings remain separate, lazy chunks; no traversal of later fields occurs before painting them. */
export function* recordedValues(value: any, indent = 0, ancestors = new Set<object>()): Generator<PaneContent> {
  if (typeof value === "string") { yield { text: value.length ? value : '""', indent }; return; }
  if (value === null || typeof value !== "object") { yield { text: scalar(value), indent }; return; }
  if (ancestors.has(value)) { yield { text: "[circular reference]", indent }; return; }
  ancestors.add(value);
  let count = 0;
  for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
    count++;
    const field = value[key];
    const label = Array.isArray(value) ? `[${key}]` : key;
    if (field === null || typeof field !== "object" && typeof field !== "string") yield { text: `${label}: ${scalar(field)}`, indent, kind: "field" };
    else {
      yield { text: `${label}:`, indent, kind: "field" };
      yield* recordedValues(field, indent + 2, ancestors);
    }
  }
  if (!count) yield { text: Array.isArray(value) ? "[]" : "{}", indent };
  ancestors.delete(value);
}
