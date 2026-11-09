import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPicture, blurScore, toGray, glareShare, findCardBlobs, jpegQuality, MESSAGES, MULTI_ADVICE } from './gateCheck.js';

// Synthetic ImageData: a "text page" of dark bars on paper, with optional box blur, darkness, glare patch.
function page({ w = 1000, h = 1300, paper = 235, ink = 20 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const line = Math.floor(y / 36), inLine = y % 36 < 18 && line > 1 && line < 34;
      const letter = inLine && x > 60 && x < w - 60 && Math.floor(x / 7) % 3 !== 0 && ((x * 7 + line * 13) % 11) > 3;
      const v = letter ? ink : paper;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function boxBlur(img, radius) {
  const { data, width: w, height: h } = img, out = new Uint8ClampedArray(data.length);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal then vertical running averages (one channel is enough: the image is grey)
    const src = pass === 0 ? data : out, dst = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = pass === 0 ? x + k : x, yy = pass === 0 ? y : y + k;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += src[(yy * w + xx) * 4]; n++; }
      }
      const i = (y * w + x) * 4; dst[i] = dst[i + 1] = dst[i + 2] = s / n; dst[i + 3] = 255;
    }
    out.set(dst);
  }
  return { data: out, width: w, height: h };
}

const meta = (img, bytes = 400_000) => ({ bytes, width: img.width, height: img.height });
const codes = (r, severity) => r.reasons.filter((x) => !severity || x.severity === severity).map((x) => x.code);

test('a sharp page is accepted', () => {
  const img = page();
  const r = checkPicture(img, meta(img), 'document');
  assert.equal(r.verdict, 'accept', JSON.stringify(r.reasons));
});

test('blur score falls as blur grows, and heavy blur is rejected', () => {
  const sharp = page();
  const scores = [0, 2, 4, 8].map((radius) => blurScore(toGray(radius ? boxBlur(sharp, radius) : sharp)));
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], scores.join(' '));
  const blurred = boxBlur(sharp, 8);
  assert.ok(codes(checkPicture(blurred, meta(blurred), 'id-card'), 'reject').includes('blurry'));
});

test('profiles differ: a lightly soft picture passes photo but not id-card', () => {
  const soft = boxBlur(page(), 3);
  assert.ok(!codes(checkPicture(soft, meta(soft), 'photo')).includes('blurry'));
  assert.ok(codes(checkPicture(soft, meta(soft), 'id-card')).includes('blurry'));
});

test('dark pictures are rejected', () => {
  const dark = page({ paper: 60, ink: 5 });
  assert.ok(codes(checkPicture(dark, meta(dark), 'document'), 'reject').includes('tooDark'));
});

test('washed out pictures are warned about', () => {
  const washed = page({ paper: 250, ink: 215 });
  assert.ok(codes(checkPicture(washed, meta(washed), 'generic')).includes('washedOut'));
});

test('a glare patch on grey paper is found; white paper hides it (honest limit)', () => {
  const grey = page({ paper: 215 });
  for (let y = 300; y < 800; y++) for (let x = 300; x < 800; x++) { const i = (y * grey.width + x) * 4; grey.data[i] = grey.data[i + 1] = grey.data[i + 2] = 255; }
  assert.ok(glareShare(toGray(grey)) > 0.1);
  assert.ok(codes(checkPicture(grey, meta(grey), 'id-card'), 'reject').includes('glare'));
  const white = page({ paper: 245 });
  assert.equal(glareShare(toGray(white)), 0);
});

test('small dimensions and big files are refused', () => {
  const img = page({ w: 300, h: 400 });
  assert.ok(codes(checkPicture(img, meta(img), 'id-card'), 'reject').includes('tooSmall'));
  const ok = page();
  assert.ok(codes(checkPicture(ok, meta(ok, 40 * 1024 * 1024), 'generic'), 'reject').includes('tooLarge'));
});

test('unknown profile is an error', () => {
  const img = page({ w: 100, h: 100 });
  assert.throws(() => checkPicture(img, meta(img), 'passport'));
});

function sheet(cards, cardW, cardH, w = 1600, h = 1000) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 90; }
  cards.forEach(([cx, cy]) => {
    for (let y = cy; y < cy + cardH; y++) for (let x = cx; x < cx + cardW; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 225; }
  });
  return { data, width: w, height: h };
}

test('multi-id counts the cards and the smallest card size', () => {
  const img = sheet([[100, 100], [700, 100], [100, 550], [700, 550]], 520, 330);
  const blobs = findCardBlobs(toGray(img));
  assert.equal(blobs.length, 4);
  const r = checkPicture(img, meta(img), 'multi-id');
  assert.equal(r.scores.cards, 4);
  assert.ok(Math.abs(r.scores.smallestCardLongSide - 520) < 40);
  assert.ok(codes(r).includes('cardsUnreadable'), 'cards of 520 px are below the 600 px advice');
});

test('multi-id rejects when there are too many cards', () => {
  const spots = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) spots.push([40 + c * 380, 30 + r * 240]);
  const img = sheet(spots, 330, 200, 1600, 1000);
  const r = checkPicture(img, meta(img), 'multi-id');
  assert.ok(codes(r, 'reject').includes('tooManyCards'));
  assert.ok(r.reasons.find((x) => x.code === 'tooManyCards').message.startsWith('More than 12 cards found in one photo.'));
  assert.equal(r.advice, MULTI_ADVICE);
});

test('multi-id names the advice line: at most 12 cards, each about 600 px', () => {
  const img = sheet([[100, 100], [700, 100], [100, 550], [700, 550]], 520, 330);
  const r = checkPicture(img, meta(img), 'multi-id');
  const msg = r.reasons.find((x) => x.code === 'cardsUnreadable').message;
  assert.ok(msg.startsWith('4 of 4 cards are too small to read.') && msg.endsWith(MULTI_ADVICE), msg);
  assert.ok(MULTI_ADVICE.includes('at most 12 cards') && MULTI_ADVICE.includes('600 pixels'));
  const big = sheet([[100, 100], [800, 100]], 640, 400, 1600, 1000);
  assert.equal(checkPicture(big, meta(big), 'multi-id').advice, null);
});

// libjpeg's standard luminance table (ITU-T T.81 Annex K) scaled to `quality` the way libjpeg and Pillow do, in a minimal
// JPEG header (SOI, APP0, DQT, SOS): enough for jpegQuality, which never decodes pixels.
const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
function jpegHeader(quality) {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const table = STD_LUMA.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  return Uint8Array.from([0xff, 0xd8, ...app0, 0xff, 0xdb, 0x00, 0x43, 0x00, ...table, 0xff, 0xda, 0x00, 0x08]);
}

test('jpegQuality reads the quality from the original file\'s table, like the server', () => {
  for (const q of [20, 45, 80, 95]) {
    const got = jpegQuality(jpegHeader(q));
    assert.ok(Math.abs(got - q) <= 1.5, `${q} -> ${got}`);
  }
  // at 12 and below the table saturates at 255: q10 reads 14.7, the same number the server reads from a Pillow q10 file
  assert.equal(jpegQuality(jpegHeader(10)), 14.7);
  assert.equal(jpegQuality(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null); // PNG
  assert.equal(jpegQuality(new Uint8Array(0)), null);
  assert.equal(jpegQuality(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08])), null); // no table
  assert.equal(jpegQuality(jpegHeader(80).slice(0, 30)), null); // cut inside the table
});

test('a heavily compressed upload is refused with the server\'s reason, a phone photo is not', () => {
  const img = page();
  const at = (q, profile = 'id-card') => checkPicture(img, { ...meta(img), jpegQuality: jpegQuality(jpegHeader(q)) }, profile);
  assert.ok(codes(at(12), 'reject').includes('tooCompressed'));
  assert.ok(codes(at(35), 'warn').includes('tooCompressed'));
  assert.ok(!codes(at(92)).includes('tooCompressed'));
  assert.ok(!codes(at(35, 'photo')).includes('tooCompressed'));
  assert.equal(at(12).reasons.find((x) => x.code === 'tooCompressed').message, MESSAGES.tooCompressed);
  assert.ok(!codes(checkPicture(img, meta(img), 'id-card')).includes('tooCompressed')); // no quality given (a PNG): no reason
});
