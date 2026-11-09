/**
 * Quick quality check for a photo BEFORE upload, on a canvas.
 *
 * THIS IS A CONVENIENCE FOR INSTANT FEEDBACK, NOT THE GATE. Anyone can skip this code, so the server's
 * quality gate is the real check. The reason codes and plain messages match the server's, but the numbers
 * here are cheap estimates on a downscaled copy and their limits are tuned separately.
 *
 * No dependencies. Works on anything shaped like ImageData ({ data: RGBA bytes, width, height }), so it runs in
 * browsers (canvas.getContext('2d').getImageData) and in Node tests with synthetic data.
 */

export const MESSAGES = {
  blurry: 'The photo is too blurry. Hold the phone steady and take it again.',
  tooDark: 'The photo is too dark. Move to better light and take it again.',
  washedOut: 'The photo is too bright or washed out. Avoid direct light and take it again.',
  glare: 'There is a bright reflection on the document. Tilt it slightly or move away from the light.',
  tooSmall: 'The picture is too small. Take it again closer, or at a higher quality setting.',
  tooLarge: 'The file is too large.',
  cardsUnreadable: 'Some cards in this photo cannot be read. Photograph the IDs in smaller groups (4 or fewer per photo).',
  tooManyCards: 'There are too many cards in one photo. Photograph the IDs in smaller groups (4 or fewer per photo).',
  tooCompressed: 'Picture too compressed. Send the original photo, not a compressed copy (for example one forwarded through a chat app).',
};

// The server's advice line for a photo of several cards (app/profiles.py MULTI_ADVICE), word for word.
export const MULTI_ADVICE = 'Photograph at most 12 cards per photo, laid flat and not touching, close enough that each card is at least about '
  + '600 pixels long; with a low-resolution camera, use fewer cards per photo.';

// JPEG quality limits (warn, reject) per profile, the same as the server's (app/profiles.py JPEG_QUALITY).
export const JPEG_QUALITY = { 'id-card': [45, 25], 'multi-id': [45, 25], document: [40, 20], generic: [35, 15], photo: [30, 12] };

const STD_LUMA_SUM = 3688; // libjpeg's standard luminance table at quality 50 (ITU-T T.81 Annex K)

/**
 * JPEG quality (libjpeg scale 1-100) of the ORIGINAL file, from its first luminance quantisation table (DQT id 0); null when the
 * bytes are not a JPEG or carry no table. The same estimate as the server's app/compression.py, so the phone can say "too
 * compressed" before uploading a copy forwarded through a chat app.
 */
export function jpegQuality(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // image data reached without a table
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2 || p + 2 + len > b.length) return null;
    if (marker === 0xdb) {
      let q = p + 4;
      const end = p + 2 + len;
      while (q < end) {
        const precision = b[q] >> 4, id = b[q] & 0x0f;
        const size = precision ? 128 : 64;
        if (q + 1 + size > end) return null;
        if (id === 0) {
          let sum = 0;
          for (let k = 0; k < 64; k++) sum += precision ? (b[q + 1 + 2 * k] << 8) | b[q + 2 + 2 * k] : b[q + 1 + k];
          const scale = (sum / STD_LUMA_SUM) * 100;
          const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
          return Math.round(Math.max(1, Math.min(100, quality)) * 10) / 10;
        }
        q += 1 + size;
      }
    }
    p += 2 + len;
  }
  return null;
}

// Limits per profile, measured on a copy whose long side is WORK_SIDE pixels. Tuned on synthetic pages;\n// calibrate on real photos before relying on them (the server's scripts/calibrate.py shows how).
export const WORK_SIDE = 640;
export const PROFILES = {
  'id-card': { blurReject: 250, blurWarn: 700, darkReject: 90, darkWarn: 130, glareWarn: 0.02, glareReject: 0.06, minShort: 400, minShortWarn: 600 },
  document: { blurReject: 120, blurWarn: 400, darkReject: 80, darkWarn: 120, glareWarn: 0.05, glareReject: 0.15, minShort: 480, minShortWarn: 800 },
  photo: { blurReject: 25, blurWarn: 100, darkReject: 50, darkWarn: 75, glareWarn: 1, glareReject: 1, minShort: 300, minShortWarn: 600 },
  generic: { blurReject: 60, blurWarn: 200, darkReject: 70, darkWarn: 110, glareWarn: 0.08, glareReject: 1, minShort: 300, minShortWarn: 600 },
  'multi-id': { blurReject: 250, blurWarn: 700, darkReject: 90, darkWarn: 130, glareWarn: 0.02, glareReject: 0.06, minShort: 400, minShortWarn: 600,
                maxCards: 12, minCardLongSide: 600 },
};
export const MAX_BYTES = 25 * 1024 * 1024;

/** Grey values (0..255) of an RGBA image, shrunk by box averaging so the long side is at most `side`. */
export function toGray(image, side = WORK_SIDE) {
  const { data, width, height } = image;
  const factor = Math.max(1, Math.floor(Math.max(width, height) / side));
  const w = Math.floor(width / factor), h = Math.floor(height / factor);
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * width + (x * factor + dx)) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      gray[y * w + x] = sum / (factor * factor);
    }
  }
  return { gray, w, h, factor };
}

/** 95th percentile of the Laplacian variance over 32 px tiles: the sharpest tiles decide. */
export function blurScore({ gray, w, h }) {
  const tile = 32, variances = [];
  for (let ty = 1; ty + tile < h - 1; ty += tile) {
    for (let tx = 1; tx + tile < w - 1; tx += tile) {
      let sum = 0, sumSq = 0, n = 0;
      for (let y = ty; y < ty + tile; y++) {
        for (let x = tx; x < tx + tile; x++) {
          const l = gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * gray[y * w + x];
          sum += l; sumSq += l * l; n++;
        }
      }
      variances.push(sumSq / n - (sum / n) ** 2);
    }
  }
  if (!variances.length) return 0;
  variances.sort((a, b) => a - b);
  return variances[Math.floor(0.95 * (variances.length - 1))];
}

export function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/** Share of blown-out pixels in big patches, only when the paper itself is not saturated. */
export function glareShare({ gray, w, h }) {
  if (percentile(gray, 0.5) >= 238) return 0;
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) bright[i] = gray[i] >= 250 ? 1 : 0;
  const seen = new Uint8Array(w * h), stack = [];
  let total = 0;
  for (let start = 0; start < bright.length; start++) {
    if (!bright[start] || seen[start]) continue;
    let size = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && bright[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (size > 0.004 * w * h) total += size;
  }
  return total / (w * h);
}

/** Cards in the picture: blobs that differ from the border colour, with a card-like shape. Returns long sides in ORIGINAL pixels. */
export function findCardBlobs({ gray, w, h, factor }) {
  const edge = [];
  const t = Math.max(2, Math.floor(0.04 * Math.min(w, h)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) edge.push(gray[y * w + x]);
  const background = percentile(edge, 0.5);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = Math.abs(gray[i] - background) > 25 ? 1 : 0;
  const seen = new Uint8Array(w * h), blobs = [], stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = w, maxX = 0, minY = h, maxY = 0, size = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const ratio = Math.max(bw, bh) / Math.min(bw, bh);
    if (size > 0.004 * w * h && ratio >= 1.15 && ratio <= 2.3 && size / (bw * bh) > 0.5) blobs.push(Math.max(bw, bh) * factor);
  }
  return blobs.sort((a, b) => b - a);
}

/**
 * Check one picture. `meta` = { bytes, width, height, jpegQuality? } of the ORIGINAL picture (jpegQuality from jpegQuality(file
 * bytes), null or absent for other formats); `image` = ImageData (any size).
 * Returns { ok, verdict: 'accept'|'warn'|'reject', reasons: [{code, severity, message}], scores }.
 */
export function checkPicture(image, meta, profile = 'generic') {
  const limits = PROFILES[profile];
  if (!limits) throw new Error(`unknown profile ${profile}`);
  const reasons = [];
  const add = (code, severity, message = MESSAGES[code]) => reasons.push({ code, severity, message });
  if (meta.bytes > MAX_BYTES) add('tooLarge', 'reject');
  const short = Math.min(meta.width, meta.height);
  if (short < limits.minShort) add('tooSmall', 'reject');
  else if (short < limits.minShortWarn) add('tooSmall', 'warn');
  const g = toGray(image);
  const scores = { blur: blurScore(g), brightnessP99: percentile(g.gray, 0.99), p1: percentile(g.gray, 0.01), glare: glareShare(g) };
  if (scores.blur < limits.blurReject) add('blurry', 'reject');
  else if (scores.blur < limits.blurWarn) add('blurry', 'warn');
  if (scores.brightnessP99 < limits.darkReject) add('tooDark', 'reject');
  else if (scores.brightnessP99 < limits.darkWarn) add('tooDark', 'warn');
  if (scores.p1 > 200) add('washedOut', 'warn');
  if (scores.glare > limits.glareReject) add('glare', 'reject');
  else if (scores.glare > limits.glareWarn) add('glare', 'warn');
  if (meta.jpegQuality != null) {
    scores.jpegQuality = meta.jpegQuality;
    const [warn, reject] = JPEG_QUALITY[profile];
    if (meta.jpegQuality < reject) add('tooCompressed', 'reject');
    else if (meta.jpegQuality < warn) add('tooCompressed', 'warn');
  }
  let advice = null;
  if (profile === 'multi-id') {
    const cards = findCardBlobs(g);
    scores.cards = cards.length;
    scores.smallestCardLongSide = cards.length ? Math.round(cards[cards.length - 1]) : 0;
    if (cards.length > limits.maxCards) add('tooManyCards', 'reject', `More than ${limits.maxCards} cards found in one photo. ${MULTI_ADVICE}`);
    const small = cards.filter((c) => c < limits.minCardLongSide).length;
    if (small) add('cardsUnreadable', small / cards.length >= 0.5 ? 'reject' : 'warn', `${small} of ${cards.length} cards are too small to read. ${MULTI_ADVICE}`);
    if (reasons.some((r) => r.code === 'tooManyCards' || r.code === 'cardsUnreadable')) advice = MULTI_ADVICE;
  }
  const verdict = reasons.some((r) => r.severity === 'reject') ? 'reject' : reasons.length ? 'warn' : 'accept';
  return { ok: verdict !== 'reject', verdict, reasons, scores, advice };
}

/** Browser helper: draw a File/Blob onto a canvas and check it. Not used by the tests (needs a DOM). */
export async function checkFile(file, profile = 'generic') {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  // the quantisation table sits in the first few kilobytes of a JPEG: read only those
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  return checkPicture(image, { bytes: file.size, width: bitmap.width, height: bitmap.height, jpegQuality: jpegQuality(head) }, profile);
}
