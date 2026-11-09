// The saved sidebar and panel choices as ONE small preference cookie (R48): the server reads it so the first paint of a reload already has the right widths (no layout shift),
// and the shell writes it when the person folds or opens a panel. It holds three on/off flags and nothing else: no name, no id, no token. localStorage keeps its own copy
// as before (older saves are taken over once).
export const PANELS_COOKIE = "hms_ui";

export interface ShellPanels {
  collapsed: boolean;
  subHidden: boolean;
  sub2Hidden: boolean;
}

/** "101" style: sidebar folded, second panel hidden, third panel hidden. Anything else is ignored. */
export function parsePanels(raw: string): ShellPanels | null {
  return /^[01]{3}$/.test(raw) ? { collapsed: raw[0] === "1", subHidden: raw[1] === "1", sub2Hidden: raw[2] === "1" } : null;
}

export function panelsValue(p: ShellPanels): string {
  return `${p.collapsed ? 1 : 0}${p.subHidden ? 1 : 0}${p.sub2Hidden ? 1 : 0}`;
}

/** Browser only. A year, this site only, no script secrets inside. */
export function writePanelsCookie(p: ShellPanels): void {
  try {
    document.cookie = `${PANELS_COOKIE}=${panelsValue(p)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // cookies blocked: the saved choice then lives in localStorage only
  }
}
