// Demo only (dev and local-demo builds): which demo accounts have switched the emailed sign-in code ON (decision 46). Nobody has it by default; a person turns it on for
// their own account in My Profile, and the demo sign-in then asks for the code (auth-pallav/mock.ts). Kept for the tab (sessionStorage), so the reload that
// follows a demo sign-out does not forget it; a new tab starts again with everyone off.
const STORE_KEY = 'hms-mock-registered-guests:code';
type TabStore = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function tab(): TabStore | null {
  try {
    return (globalThis as { sessionStorage?: TabStore }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function load(): Set<string> {
  try {
    const raw = tab()?.getItem(STORE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

const on = load();
const key = (username: string): string => username.trim().toLowerCase();

export const mockCodeRequired = (username: string): boolean => on.has(key(username));

export function mockSetCodeRequired(username: string, value: boolean): void {
  if (value) on.add(key(username));
  else on.delete(key(username));
  try {
    tab()?.setItem(STORE_KEY, JSON.stringify([...on]));
  } catch {
    /* storage refused: kept for this page only */
  }
}
