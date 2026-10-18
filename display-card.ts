import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const cardPadding = (width: number) => width >= 4 ? 1 : 0;
export const cardContentWidth = (width: number) => Math.max(1, width - cardPadding(width) * 2);

/** The legacy card fill: keep the base surface after nested ANSI resets.
 * Extended color payloads are data, not SGR reset codes. */
export function fillBackground(line: string, width: number, theme: any, background: string): string {
  const content = truncateToWidth(line, width, "");
  const padded = content + " ".repeat(Math.max(0, width - visibleWidth(content)));
  if (typeof theme?.bg !== "function") return padded;
  const base = theme.bg(background, "").replace(/\x1b\[49m$/, "");
  const restored = padded.replace(/\x1b\[([0-9;:]*)m/g, (escape, parameters: string) => {
    const codes = parameters.split(";");
    let reset = false;
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i].split(":")[0]);
      if (code === 0 || code === 49) reset = true;
      else if (code >= 40 && code <= 47 || code >= 100 && code <= 107 || code === 48) reset = false;
      if ((code === 38 || code === 48 || code === 58) && !codes[i].includes(":")) {
        const mode = Number(codes[++i]);
        i += mode === 2 ? 3 : mode === 5 ? 1 : 0;
      }
    }
    return escape + (reset ? base : "");
  });
  return base + restored + "\x1b[49m";
}

/** Callers lay out within cardContentWidth; fill includes both horizontal gutters. */
export function cardRow(line: string, width: number, theme: any, background: string): string {
  return fillBackground(" ".repeat(cardPadding(width)) + truncateToWidth(line, cardContentWidth(width), ""), width, theme, background);
}
