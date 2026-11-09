/**
 * "Card too far" and the multi-card hint, decided on the phone before upload.
 *
 * Resolution is judged as print dots per inch: a card's long side in SOURCE pixels against its printed size. The two
 * limits (150 too coarse to read, 200 good) are COPIED from intake-worker on 2026-11-05 (its clarity check grades a card
 * with the same numbers), so the phone asks for a retake where the server would call the card unclear.
 *
 * findCards() finds up to 12 separate cards lying on a plain surface in one picture (pure JavaScript: difference from the
 * surface colour, connected blobs, extreme corners). Cards that touch merge into one blob and are then not counted as a
 * card; the worker's own card cutter is the real step. A hint only.
 */
import { dist, isConvex, orderCorners, quadArea } from './geometry.js';
import { percentile, toGray } from './checks.js';

/** Printed long sides in millimetres: ID-1 (Aadhaar, PAN, licence, OCI card) and ID-3 (passport page, visa). */
export const CARD_MM = { id1: 85.6, id3: 125 };
export const CARD_LIMITS = { dpiReject: 150, dpiWarn: 200, maxCards: 12, advisedCards: 4 };

export const CARD_MESSAGES = {
  cardTooFar: 'The card is too far away. Move closer.',
  cardSmall: 'Move a little closer for a sharper picture.',
  cardsTooSmall: 'The cards are too small. Photograph 4 or fewer at a time.',
  cardsSmall: 'The cards are small. 4 or fewer per photo reads better.',
  tooManyCards: 'More than 12 cards. Photograph 4 or fewer at a time.',
  noCard: 'No card found. Place the card on a plain, darker surface.',
};

const sides = (q) => {
  const top = dist(q[0], q[1]), bottom = dist(q[3], q[2]), left = dist(q[0], q[3]), right = dist(q[1], q[2]);
  const across = Math.max(top, bottom), down = Math.max(left, right);
  return { long: Math.max(across, down), short: Math.min(across, down) };
};

/**
 * Estimated print resolution of a card outline (quad in SOURCE pixels). A wide outline (long/short >= 1.5) is taken as an
 * ID-1 card, a squarer one as a passport page (ID-3). Returns { dpi, long, short, ratio, format }.
 */
export function cardDpi(quad) {
  const { long, short } = sides(quad);
  const ratio = short ? long / short : 0;
  const format = ratio >= 1.5 ? 'id1' : 'id3';
  return { dpi: Math.round((long / (CARD_MM[format] / 25.4)) * 10) / 10, long, short, ratio, format };
}

/** { code, level: 'ok'|'warn'|'reject', message, dpi } for one card outline in SOURCE pixels. */
export function cardSizeCheck(quad) {
  const { dpi } = cardDpi(quad);
  if (dpi < CARD_LIMITS.dpiReject) return { code: 'cardTooFar', level: 'reject', message: CARD_MESSAGES.cardTooFar, dpi };
  if (dpi < CARD_LIMITS.dpiWarn) return { code: 'cardSmall', level: 'warn', message: CARD_MESSAGES.cardSmall, dpi };
  return { code: '', level: 'ok', message: '', dpi };
}

/**
 * Card-like blobs in a picture (ImageData-like). Returns [{ quad (source pixels, tl tr br bl), dpi, format }] in reading
 * order (top to bottom, then left to right). A blob counts when it is convex, fills at least 60% of its outline, has the
 * shape of a card or page (long/short 1.15-2.3) and covers at least 0.2% of the picture.
 */
export function findCards(image, { workSide = 600 } = {}) {
  const { gray, w, h } = toGray(image, workSide);
  const scale = image.width / w;
  const border = [], t = Math.max(2, Math.floor(0.02 * Math.min(w, h)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) border.push(gray[y * w + x]);
  const background = percentile(border, 0.5);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = Math.abs(gray[i] - background) > 30 ? 1 : 0;
  const seen = new Uint8Array(w * h), stack = [], cards = [];
  const minSize = Math.max(60, 0.002 * w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0, tl = start, br = start, tr = start, bl = start;
    const sx = start % w, sy = (start - sx) / w;
    let kTl = sx + sy, kBr = kTl, kTr = sy - sx, kBl = kTr;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      if (x + y < kTl) { kTl = x + y; tl = p; }
      if (x + y > kBr) { kBr = x + y; br = p; }
      if (y - x < kTr) { kTr = y - x; tr = p; }
      if (y - x > kBl) { kBl = y - x; bl = p; }
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (size < minSize) continue;
    // Corner pixels are pixel centres: push them out by half a pixel so the outline covers the whole blob.
    const quad = orderCorners([tl, tr, br, bl].map((p) => [(p % w + 0.5) * scale, (Math.floor(p / w) + 0.5) * scale]));
    const area = quadArea(quad);
    if (!area || !isConvex(quad)) continue;
    const fill = (size * scale * scale) / area;
    const info = cardDpi(quad);
    if (fill < 0.6 || fill > 1.6 || info.ratio < 1.15 || info.ratio > 2.3) continue;
    cards.push({ quad, dpi: info.dpi, format: info.format });
  }
  const centre = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
  const rowH = cards.length ? Math.min(...cards.map((c) => cardDpi(c.quad).short)) / 2 : 1;
  return cards.sort((a, b) => {
    const [ax, ay] = centre(a.quad), [bx, by] = centre(b.quad);
    return Math.abs(ay - by) > rowH ? ay - by : ax - bx;
  });
}

/**
 * One plain hint for a gallery picture from its found cards: { code, level: 'ok'|'info'|'warn'|'reject', message, count }.
 * Several cards are fine (the worker cuts them apart, up to 12), but each must still be large enough to read.
 */
export function multiCardAdvice(cards) {
  const count = cards.length;
  const pick = (code, level, message = CARD_MESSAGES[code]) => ({ code, level, message, count });
  if (count === 0) return pick('noCard', 'warn');
  if (count > CARD_LIMITS.maxCards) return pick('tooManyCards', 'reject');
  const worst = Math.min(...cards.map((c) => c.dpi));
  if (worst < CARD_LIMITS.dpiReject) return count > 1 ? pick('cardsTooSmall', 'reject') : pick('cardTooFar', 'reject');
  if (worst < CARD_LIMITS.dpiWarn) return count > 1 ? pick('cardsSmall', 'warn') : pick('cardSmall', 'warn');
  return count > 1 ? pick('multipleCards', 'info', `${count} cards found.`) : pick('', 'ok', '');
}
