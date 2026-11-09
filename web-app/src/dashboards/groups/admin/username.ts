// A username suggested from a person's name, and the first free one from a base.
/** "Anita Shah" -> "anita.shah": letters and numbers of the name, words joined by dots. */
export function usernameFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, '')
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('.')
    .slice(0, 50);
}

/** The first free username from a base: base, base2, base3 ... */
export function freeUsername(base: string, taken: ReadonlySet<string>): string {
  if (!base || !taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  return base;
}
