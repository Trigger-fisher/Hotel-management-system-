import "server-only";
import { posix } from "node:path";

// The forms of a request path that a rule must be tested against (security review round 3, the percent-encoding question). The rules test the path as it arrived, but a
// dynamic segment of a route (/admin/settings/[group]) reaches its handler DECODED, and routing may be case-insensitive: "/admin/settings/%65mail" is the group "email". A rule
// that only saw the raw text would let it through. So every rule is tested against the raw path, the once- and twice-decoded path, each also with its dot segments resolved
// ("/platform/..%2Frevenue" is "/revenue"), all lower-cased: a path is treated as denied when ANY form is denied (and as a hotel write unless EVERY form is a console one:
// fail closed).
export function pathForms(pathname: string): string[] {
  const forms = new Set<string>();
  const add = (p: string): void => {
    forms.add(p.toLowerCase());
    forms.add(posix.normalize(p).toLowerCase());
  };
  add(pathname);
  let current = pathname;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      add(decoded);
      current = decoded;
    } catch {
      break; // a malformed escape: nothing more to decode
    }
  }
  return [...forms];
}
