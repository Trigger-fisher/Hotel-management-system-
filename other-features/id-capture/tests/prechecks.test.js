import test from 'node:test';
import assert from 'node:assert/strict';
import { readJpegHeader, qualityFromTable, tableForQuality, compressionCheck, JPEG_MESSAGES } from '../src/jpeg.js';
import { cardDpi, cardSizeCheck, findCards, multiCardAdvice, CARD_MESSAGES } from '../src/cards.js';
import { faceAdvice, detectFaces, faceHintSupported, FACE_MESSAGES } from '../src/face.js';
import { quickChecks, MESSAGES } from '../src/checks.js';
import { checkGalleryFile } from '../src/gallery.js';

// ---------- invented JPEG headers (no picture data is needed: the checks read the header only) ----------
function jpegHeader({ quality = 90, width = 1600, height = 1200, sixteenBit = false, withTable = true, pad = 0 } = {}) {
  const b = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  if (withTable) {
    const t = tableForQuality(quality);
    const body = sixteenBit ? [0x10, ...t.flatMap((v) => [v >> 8, v & 255])] : [0x00, ...t];
    b.push(0xff, 0xdb, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
    const chroma = [0x01, ...tableForQuality(quality).map((v) => Math.min(255, v * 2))];
    b.push(0xff, 0xdb, 0, chroma.length + 2, ...chroma);
  }
  b.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  b.push(0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0);
  for (let i = 0; i < pad; i++) b.push(0x55);
  b.push(0xff, 0xd9);
  return Uint8Array.from(b);
}

test('JPEG header: size and quantisation tables are read, 8-bit and 16-bit', () => {
  const h = readJpegHeader(jpegHeader({ quality: 75, width: 1234, height: 567 }));
  assert.equal(h.width, 1234); assert.equal(h.height, 567); assert.equal(h.progressive, false);
  assert.deepEqual(h.tables[0], tableForQuality(75));
  assert.deepEqual(readJpegHeader(jpegHeader({ quality: 30, sixteenBit: true })).tables[0], tableForQuality(30));
});

test('JPEG quality is read back within 1 point on the libjpeg scale (24 to 98); lower ones saturate at 255 but still read below 25', () => {
  for (let q = 24; q <= 98; q++) {
    const est = qualityFromTable(tableForQuality(q));
    assert.ok(Math.abs(est - q) <= 1, `q${q} read as ${est}`);
  }
  for (let q = 1; q < 24; q++) assert.ok(qualityFromTable(tableForQuality(q)) < 25, `q${q}`);
});

test('heavy compression: quality below 25 heavy, below 45 compressed, else ok; plain short messages', () => {
  assert.equal(compressionCheck(jpegHeader({ quality: 15 })).level, 'heavy');
  assert.equal(compressionCheck(jpegHeader({ quality: 3 })).level, 'heavy'); // saturated tables still read low
  assert.equal(compressionCheck(jpegHeader({ quality: 20 })).message, JPEG_MESSAGES.jpegHeavy);
  const mid = compressionCheck(jpegHeader({ quality: 40 }));
  assert.deepEqual([mid.level, mid.code], ['warn', 'jpegCompressed']);
  assert.equal(compressionCheck(jpegHeader({ quality: 75 })).level, 'ok');
  assert.equal(compressionCheck(jpegHeader({ quality: 92 })).message, '');
  for (const m of Object.values(JPEG_MESSAGES)) assert.ok(m.split(' ').length <= 12, m);
});

test('no table: bytes per pixel decides (file size against the picture size)', () => {
  const header = jpegHeader({ withTable: false, width: 1000, height: 1000 });
  assert.equal(compressionCheck(header, 20000).level, 'heavy'); // 0.02 bytes per pixel
  assert.equal(compressionCheck(header, 50000).level, 'warn');  // 0.05
  const ok = compressionCheck(header, 300000);                   // 0.3, a phone photo
  assert.deepEqual([ok.level, ok.bytesPerPixel], ['ok', 0.3]);
});

test('not a JPEG or a cut header: no warning and no crash', () => {
  assert.equal(compressionCheck(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])).level, 'unknown');
  assert.equal(compressionCheck(new Uint8Array(0)).level, 'unknown');
  const cut = jpegHeader({ quality: 20 }).slice(0, 30);
  assert.doesNotThrow(() => compressionCheck(cut));
  assert.equal(readJpegHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 1])), null);
});

test('gallery check carries the compression warning for JPEGs only, and still accepts the file', () => {
  const heavy = checkGalleryFile(jpegHeader({ quality: 12 }));
  assert.deepEqual([heavy.ok, heavy.kind, heavy.warning], [true, 'jpeg', JPEG_MESSAGES.jpegHeavy]);
  assert.equal(checkGalleryFile(jpegHeader({ quality: 90 })).warning, '');
  assert.equal(checkGalleryFile(Uint8Array.from(Buffer.from('%PDF-1.4 x', 'latin1'))).warning, '');
});

// ---------- invented pictures: light cards with dark text bars on a dark table ----------
function table(w, h, v = 70) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { data, width: w, height: h };
}
function card(img, cx, cy, long, angleDeg = 0) {
  const short = long / 1.586, a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const corners = [[-long / 2, -short / 2], [long / 2, -short / 2], [long / 2, short / 2], [-long / 2, short / 2]]
    .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(img.height - 1, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(img.width - 1, Math.ceil(Math.max(...xs))); x++) {
      const dx = x - cx, dy = y - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
      if (Math.abs(u) > long / 2 || Math.abs(v) > short / 2) continue;
      const row = Math.floor((v + short / 2) / (short / 9)), text = row % 2 === 1 && (u + long / 2) > long * 0.38 && (u + long / 2) < long * 0.92;
      const val = text ? 40 : 225, i = (y * img.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
    }
  }
  return corners;
}
const truthDpi = (long) => long / (85.6 / 25.4);

test('card dpi: ID-1 long side against 85.6 mm; a squarer page is taken as a passport page', () => {
  const q = [[0, 0], [674, 0], [674, 425], [0, 425]];
  assert.equal(Math.round(cardDpi(q).dpi), 200); assert.equal(cardDpi(q).format, 'id1');
  assert.equal(cardDpi([[0, 0], [1000, 0], [1000, 704], [0, 704]]).format, 'id3');
  assert.equal(cardSizeCheck([[0, 0], [400, 0], [400, 252], [0, 252]]).code, 'cardTooFar');  // about 119 dpi
  assert.equal(cardSizeCheck([[0, 0], [600, 0], [600, 378], [0, 378]]).code, 'cardSmall');   // about 178 dpi
  assert.equal(cardSizeCheck([[0, 0], [1000, 0], [1000, 630], [0, 630]]).level, 'ok');       // about 297 dpi
});

test('four sharp cards in one photo: all found in reading order, dpi within 5%, "4 cards found."', () => {
  const img = table(4000, 3000), long = 1300;
  card(img, 1000, 800, long, 0); card(img, 3000, 820, long, 8); card(img, 1000, 2200, long, -12); card(img, 3000, 2200, long, 3);
  const cards = findCards(img);
  assert.equal(cards.length, 4);
  for (const c of cards) assert.ok(Math.abs(c.dpi - truthDpi(long)) / truthDpi(long) < 0.05, `dpi ${c.dpi}`);
  const centres = cards.map((c) => [(c.quad[0][0] + c.quad[2][0]) / 2, (c.quad[0][1] + c.quad[2][1]) / 2]);
  assert.ok(centres[0][0] < centres[1][0] && centres[1][1] < centres[2][1] && centres[2][0] < centres[3][0], 'reading order');
  assert.deepEqual(multiCardAdvice(cards), { code: 'multipleCards', level: 'info', message: '4 cards found.', count: 4 });
});

test('twelve cards too small in one photo: "photograph 4 or fewer"', () => {
  const img = table(3000, 2000), long = 420; // about 125 dpi each
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) card(img, 400 + k * 700, 350 + r * 650, long, (r * 4 + k) % 5 - 2);
  const cards = findCards(img);
  assert.equal(cards.length, 12);
  const advice = multiCardAdvice(cards);
  assert.deepEqual([advice.code, advice.level, advice.message], ['cardsTooSmall', 'reject', CARD_MESSAGES.cardsTooSmall]);
});

test('more than 12 cards, one far card, one small card, and an empty table', () => {
  const many = table(2800, 2000);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) card(many, 330 + k * 700, 260 + r * 500, 560);
  assert.equal(findCards(many).length, 16);
  assert.equal(multiCardAdvice(findCards(many)).code, 'tooManyCards');
  const far = table(3000, 2000); card(far, 1500, 1000, 420, 10);
  assert.equal(multiCardAdvice(findCards(far)).code, 'cardTooFar');
  const near = table(2000, 1500); card(near, 1000, 750, 600, -5);
  assert.equal(multiCardAdvice(findCards(near)).code, 'cardSmall');
  const good = table(2000, 1500); card(good, 1000, 750, 1200, 4);
  assert.deepEqual(multiCardAdvice(findCards(good)), { code: '', level: 'ok', message: '', count: 1 });
  assert.equal(multiCardAdvice(findCards(table(1200, 900))).code, 'noCard');
  for (const m of Object.values(CARD_MESSAGES)) assert.ok(m.split(' ').length <= 12, m);
});

test('small specks and long strips are not counted as cards', () => {
  const img = table(2000, 1500);
  card(img, 1000, 750, 1000);
  for (let y = 100; y < 130; y++) for (let x = 100; x < 1900; x++) { const i = (y * 2000 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 230; }
  for (let y = 1400; y < 1408; y++) for (let x = 1800; x < 1808; x++) { const i = (y * 2000 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 230; }
  assert.equal(findCards(img).length, 1);
});

// ---------- live frame: blur and glare (verified), card too far ----------
function frameWithCard(w = 1000, h = 800) {
  const img = table(w, h); card(img, w / 2, h / 2, 760); return img;
}

test('per-frame checks: a sharp frame passes; blur and glare are caught', () => {
  const sharp = frameWithCard();
  assert.equal(quickChecks(sharp, 0.6).pass, true, JSON.stringify(quickChecks(sharp, 0.6).failed));
  const glare = frameWithCard();
  for (let y = 250; y < 470; y++) for (let x = 300; x < 650; x++) { const i = (y * 1000 + x) * 4; glare.data[i] = glare.data[i + 1] = glare.data[i + 2] = 255; }
  const g = quickChecks(glare, 0.6);
  assert.ok(g.failed.includes('glare') && g.messages.includes(MESSAGES.glare), JSON.stringify(g.failed));
  // Box blur, radius 10, both directions: the text bars lose their edges (out of focus).
  let src = frameWithCard().data;
  for (const horizontal of [true, false]) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < 800; y++) for (let x = 0; x < 1000; x++) {
      let s = 0, n = 0;
      for (let k = -10; k <= 10; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
        if (xx >= 0 && xx < 1000 && yy >= 0 && yy < 800) { s += src[(yy * 1000 + xx) * 4]; n++; }
      }
      const i = (y * 1000 + x) * 4; out[i] = out[i + 1] = out[i + 2] = s / n; out[i + 3] = 255;
    }
    src = out;
  }
  assert.ok(quickChecks({ data: src, width: 1000, height: 800 }, 0.6).failed.includes('blurry'));
});

test('per-frame checks: a card under 150 dpi in the full picture blocks auto-capture', () => {
  const f = frameWithCard();
  const far = quickChecks(f, 0.6, { cardDpi: 120 });
  assert.equal(far.pass, false); assert.ok(far.messages.includes(MESSAGES.cardTooFar));
  assert.equal(quickChecks(f, 0.6, { cardDpi: 260 }).pass, true);
  assert.equal(MESSAGES.cardTooFar, CARD_MESSAGES.cardTooFar);
});

// ---------- face hint ----------
test('face hint: only on the front, only when checked; none, too small, fine', () => {
  assert.deepEqual(faceAdvice(null), { code: '', message: '' });
  assert.deepEqual(faceAdvice([], 'back'), { code: '', message: '' });
  assert.equal(faceAdvice([]).message, FACE_MESSAGES.noFace);
  assert.equal(faceAdvice([{ boundingBox: { height: 30 } }]).code, 'faceSmall');
  assert.equal(faceAdvice([{ boundingBox: { height: 30 } }, { boundingBox: { height: 140 } }]).code, '');
});

test('face detector: lazy, uses the browser one when present, null when absent or failing', async () => {
  assert.equal(faceHintSupported(), typeof globalThis.FaceDetector === 'function');
  assert.equal(await detectFaces({}, undefined), null);
  let made = 0;
  class Fake { constructor(opts) { made++; this.opts = opts; } async detect() { return [{ boundingBox: { height: 99 } }]; } }
  assert.deepEqual(await detectFaces({}, Fake), [{ boundingBox: { height: 99 } }]);
  await detectFaces({}, Fake); assert.equal(made, 1, 'created once');
  class Broken { async detect() { throw new Error('no'); } }
  assert.equal(await detectFaces({}, Broken), null);
});
