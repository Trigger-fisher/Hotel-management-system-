// Pure helpers of the template picker (TemplatePicker.tsx), kept apart so a test can run them without a browser: the approved message with its blanks
// filled, the same message in pieces (plain text, a filled blank, an empty one), and a template's language as the desk offers it.
import type { WhatsAppTemplate } from '@shared/dashboards/whatsapp';

export type TemplatePart = { text: string; kind: 'plain' | 'filled' | 'missing' };

/** The message as it will go; a blank still empty shows its label in brackets ("[Guest name]"), never Meta's "{{2}}". */
export function fillTemplate(text: string, values: string[], labels: string[] = []): string {
  return text.replace(/\{\{(\d+)\}\}/g, (all, n: string) => values[Number(n) - 1]?.trim() || (labels[Number(n) - 1] ? `[${labels[Number(n) - 1]}]` : all));
}

/** The message in pieces: plain text, a blank with a value (drawn marked), a blank still empty (its label in brackets). */
export function templateParts(text: string, values: string[], labels: string[] = []): TemplatePart[] {
  const out: TemplatePart[] = [];
  const re = /\{\{(\d+)\}\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: 'plain' });
    const i = Number(m[1]) - 1;
    const v = values[i]?.trim();
    out.push(v ? { text: v, kind: 'filled' } : { text: labels[i] ? `[${labels[i]}]` : m[0], kind: 'missing' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}

/** A template's language as the desk offers it: "en_US" and "en" are both English; Hinglish stays Hinglish (it is not Hindi). */
export const langOf = (t: Pick<WhatsAppTemplate, 'language'>): string => (t.language.toLowerCase() === 'hinglish' ? 'hinglish' : t.language.toLowerCase().slice(0, 2));

export type Blank = { index: number; name: string; example: string };
const BLANK = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** Numbers the blanks 1, 2, 3 in the order they appear (Meta's rule) and keeps each blank's name and sample with it; blanks no longer in the text are dropped. */
export function renumberBlanks(body: string, blanks: readonly Blank[]): { body: string; blanks: Blank[] } {
  const order: number[] = [];
  for (const m of body.matchAll(BLANK)) if (!order.includes(Number(m[1]))) order.push(Number(m[1]));
  const next = new Map(order.map((old, i) => [old, i + 1] as const));
  return {
    body: body.replace(BLANK, (_m, n: string) => `{{${next.get(Number(n))}}}`),
    blanks: order.map((old, i) => {
      const b = blanks.find((x) => x.index === old);
      return { index: i + 1, name: b?.name ?? '', example: b?.example ?? '' };
    }),
  };
}

/** Puts a new blank where the cursor is, then numbers all blanks again. `cursor` is where the cursor goes after it. */
export function insertBlank(body: string, at: number, blanks: readonly Blank[], name: string, example: string): { body: string; blanks: Blank[]; cursor: number } {
  const pos = Math.max(0, Math.min(at, body.length));
  const temp = Math.max(0, ...blanks.map((b) => b.index), ...[...body.matchAll(BLANK)].map((m) => Number(m[1]))) + 1;
  const token = `{{${temp}}}`;
  const before = body.slice(0, pos);
  const glue = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const r = renumberBlanks(`${before}${glue}${token}${body.slice(pos)}`, [...blanks, { index: temp, name, example }]);
  const cursor = renumberBlanks(`${before}${glue}${token}`, []).body.length;
  return { ...r, cursor };
}
