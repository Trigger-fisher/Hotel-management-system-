/**
 * Quick checks on a frame or a flattened side. The reason codes and messages are COPIED from a quality-check module
 * on purpose (no import across folders); the numbers here are cheap estimates and the real check happens on the server.
 */
export const MESSAGES = {
  blurry: 'The photo is too blurry. Hold the phone steady and take it again.',
  tooDark: 'The photo is too dark. Move to better light and take it again.',
  glare: 'There is a bright reflection on the document. Tilt it slightly or move away from the light.',
  documentSmallInFrame: 'The document fills too little of the picture. Move closer.',
  tooSmall: 'The picture is too small. Take it again closer, or at a higher quality setting.',
  cardTooFar: 'The card is too far away. Move closer.',
};

// cardDpiReject is the same 150 as src/cards.js (print dots per inch of the card in the full-size picture).
export const LIMITS = { blurReject: 250, darkReject: 110, glareReject: 0.06, minQuadShare: 0.25, minSide: 480, workSide: 480, cardDpiReject: 150 };

export function toGray({ data, width, height }, side = LIMITS.workSide) {
  const factor = Math.max(1, Math.floor(Math.max(width, height) / side));
  const w = Math.floor(width / factor), h = Math.floor(height / factor), gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const i = ((y * factor + dy) * width + (x * factor + dx)) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    gray[y * w + x] = sum / (factor * factor);
  }
  return { gray, w, h };
}

export function blurScore({ gray, w, h }) {
  const tile = 24, vars = [];
  for (let ty = 1; ty + tile < h - 1; ty += tile) for (let tx = 1; tx + tile < w - 1; tx += tile) {
    let s = 0, ss = 0, n = 0;
    for (let y = ty; y < ty + tile; y++) for (let x = tx; x < tx + tile; x++) {
      const l = gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * gray[y * w + x];
      s += l; ss += l * l; n++;
    }
    vars.push(ss / n - (s / n) ** 2);
  }
  vars.sort((a, b) => a - b);
  return vars.length ? vars[Math.floor(0.95 * (vars.length - 1))] : 0;
}

export const percentile = (values, p) => Float32Array.from(values).sort()[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];

export function glareShare({ gray, w, h }) {
  if (percentile(gray, 0.5) >= 238) return 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] >= 250) bright++;
  return bright / (w * h);
}

/**
 * Quick checks for a frame. `quadShare` is the outline's share of the frame (0 when none). `cardDpi` (optional) is the
 * card's print resolution in the FULL-size picture (src/cards.js cardDpi): below 150 the card is too far away.
 */
export function quickChecks(image, quadShare = 1, { cardDpi = null } = {}) {
  const g = toGray(image);
  const scores = { blur: blurScore(g), p99: percentile(g.gray, 0.99), glare: glareShare(g), quadShare, cardDpi };
  const failed = [];
  if (scores.blur < LIMITS.blurReject) failed.push('blurry');
  if (scores.p99 < LIMITS.darkReject) failed.push('tooDark');
  if (scores.glare > LIMITS.glareReject) failed.push('glare');
  if (quadShare < LIMITS.minQuadShare) failed.push('documentSmallInFrame');
  if (Math.min(image.width, image.height) < LIMITS.minSide) failed.push('tooSmall');
  if (cardDpi !== null && cardDpi < LIMITS.cardDpiReject) failed.push('cardTooFar');
  return { pass: failed.length === 0, failed, messages: failed.map((c) => MESSAGES[c]), scores };
}
