/** The next free staff ID after the highest numbered one (EMP009 -> EMP010); empty when no ID ends in a number. */
export function nextStaffCode(codes: string[]): string {
  let best: { pre: string; n: number; width: number } | null = null;
  for (const code of codes) {
    const m = /^(.*?)(\d+)$/.exec(code.trim());
    if (!m) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { pre: m[1] ?? '', n, width: (m[2] ?? '').length };
  }
  if (!best) return '';
  const { pre, width } = best;
  const make = (k: number) => `${pre}${String(k).padStart(width, '0')}`;
  const used = new Set(codes.map((c) => c.trim().toLowerCase()));
  let n = best.n + 1;
  while (used.has(make(n).toLowerCase())) n += 1;
  return make(n);
}
