import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCorners, quadArea, isConvex, quadScore, quadShift, homography, applyHomography, warpQuad, targetSize } from '../src/geometry.js';
import { SteadyDetector } from '../src/steady.js';
import { quickChecks, MESSAGES } from '../src/checks.js';
import { detectQuad } from '../src/detect.js';
import { createSession, captured, retake, accept, redo, result, label, STEPS } from '../src/steps.js';

const frame = { width: 1000, height: 800 };

// Synthetic frame: a bright "document" quad on a dark table, text-like bars inside.
function scene(quad, { w = 1000, h = 800, blurRadius = 0 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x, y) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (cross !== 0) { if (sign === 0) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false; }
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 70;
    if (inside(x, y)) v = (Math.floor(y / 14) % 2 === 0 && Math.floor(x / 5) % 3 !== 0) ? 30 : 225;
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  if (blurRadius) {
    let src = data;
    for (const horizontal of [true, false]) {
      const out = new Uint8ClampedArray(data.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let k = -blurRadius; k <= blurRadius; k++) {
          const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += src[(yy * w + xx) * 4]; n++; }
        }
        const i = (y * w + x) * 4; out[i] = out[i + 1] = out[i + 2] = s / n; out[i + 3] = 255;
      }
      src = out;
    }
    return { data: src, width: w, height: h };
  }
  return { data, width: w, height: h };
}

test('corners are ordered tl, tr, br, bl whatever the input order', () => {
  const shuffled = [[800, 600], [100, 120], [820, 90], [90, 640]];
  assert.deepEqual(orderCorners(shuffled), [[100, 120], [820, 90], [800, 600], [90, 640]]);
});

test('area, convexity and size', () => {
  const q = [[0, 0], [100, 0], [100, 50], [0, 50]];
  assert.equal(quadArea(q), 5000);
  assert.ok(isConvex(q));
  assert.ok(!isConvex([[0, 0], [100, 0], [20, 20], [0, 50]]));
  assert.deepEqual(targetSize(q), { width: 100, height: 50 });
});

test('quad score: plausible documents score high, tiny, huge or bow-tie quads score zero', () => {
  assert.ok(quadScore([[200, 150], [800, 170], [780, 650], [180, 630]], frame) > 0.7);
  assert.equal(quadScore([[10, 10], [60, 10], [60, 40], [10, 40]], frame), 0);
  assert.equal(quadScore([[0, 0], [1000, 0], [1000, 800], [0, 800]], frame), 0);
  assert.equal(quadScore([[0, 0], [100, 100], [100, 0], [0, 100]], frame), 0);
});

test('homography maps the four corners exactly and warpQuad flattens a tilted rectangle', () => {
  const from = [[0, 0], [99, 0], [99, 49], [0, 49]], to = [[120, 80], [420, 110], [400, 330], [100, 300]];
  const h = homography(from, to);
  from.forEach((p, i) => { const [x, y] = applyHomography(h, p); assert.ok(Math.abs(x - to[i][0]) < 1e-6 && Math.abs(y - to[i][1]) < 1e-6); });
  const quad = [[200, 150], [800, 170], [780, 650], [180, 630]];
  const flat = warpQuad(scene(quad), quad);
  assert.ok(Math.abs(flat.width - 600) < 30 && Math.abs(flat.height - 480) < 30);
  let dark = 0; for (let i = 0; i < flat.data.length; i += 4) if (flat.data[i] < 100) dark++;
  assert.ok(dark / (flat.width * flat.height) > 0.2, 'text bars survive the warp');
  assert.ok(flat.data[0] !== 70 && flat.data[(flat.width + 5) * 4] !== 70, 'no table background in the corners');
});

test('the pure JavaScript detector finds a tilted document within 3% of the diagonal', () => {
  const quad = [[200, 150], [800, 190], [770, 650], [160, 620]];
  const found = detectQuad(scene(quad));
  assert.ok(found, 'a quad is found');
  const diag = Math.hypot(1000, 800);
  const err = Math.max(...found.quad.map((p, i) => Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]))) / diag;
  assert.ok(err < 0.03, `corner error ${err}`);
});

test('the detector returns nothing for an empty table', () => {
  assert.equal(detectQuad(scene([[0, 0], [1, 0], [1, 1], [0, 1]])), null);
});

test('steady detector fires after N still frames and resets on movement or failed checks', () => {
  const s = new SteadyDetector({ framesNeeded: 5, maxShift: 0.01 });
  const q = [[200, 150], [800, 170], [780, 650], [180, 630]];
  let r;
  for (let i = 0; i < 4; i++) { r = s.push(q, true, frame); assert.equal(r.steady, false); }
  assert.equal(s.push(q, true, frame).steady, true);
  assert.equal(s.push(q.map(([x, y]) => [x + 60, y]), true, frame).steady, false);  // moved
  for (let i = 0; i < 3; i++) s.push(q, true, frame);
  assert.equal(s.push(q, false, frame).progress, 0);                                  // checks failed: start over
  assert.equal(s.push(null, true, frame).steady, false);
  assert.ok(quadShift(q, q, frame) === 0);
});

test('quick checks: sharp passes; blurry, dark, glare and small-in-frame fail with the shared codes and messages', () => {
  const quad = [[100, 80], [900, 90], [890, 720], [110, 710]];
  const sharp = scene(quad);
  assert.equal(quickChecks(sharp, 0.6).pass, true, JSON.stringify(quickChecks(sharp, 0.6).failed));
  const blurred = quickChecks(scene(quad, { blurRadius: 10 }), 0.6);
  assert.ok(blurred.failed.includes('blurry') && blurred.messages[0] === MESSAGES.blurry);
  const dark = scene(quad); for (let i = 0; i < dark.data.length; i += 4) { dark.data[i] /= 5; dark.data[i + 1] /= 5; dark.data[i + 2] /= 5; }
  assert.ok(quickChecks(dark, 0.6).failed.includes('tooDark'));
  assert.ok(quickChecks(sharp, 0.1).failed.includes('documentSmallInFrame'));
  assert.ok(quickChecks({ data: new Uint8ClampedArray(300 * 200 * 4).fill(200), width: 300, height: 200 }, 0.6).failed.includes('tooSmall'));
});

test('step state machine: front, review, retake, back, done; result has both sides in order', () => {
  let s = createSession('abc');
  assert.equal(label(s), 'Step 1 of 2: front');
  s = captured(s, { blob: 'f1', width: 10, height: 5, quad: null, checks: { pass: true } });
  assert.equal(s.phase, 'reviewing');
  s = retake(s); assert.equal(s.phase, 'capturing'); assert.equal(s.sides.length, 0);
  s = accept(captured(s, { blob: 'f2', width: 10, height: 5, quad: null, checks: { pass: true } }));
  assert.equal(label(s), 'Step 2 of 2: back');
  s = accept(captured(s, { blob: 'b1', width: 8, height: 4, quad: [[0, 0]], checks: { pass: false } }));
  assert.equal(s.phase, 'done');
  const out = result(s);
  assert.equal(out.sessionId, 'abc'); assert.deepEqual(out.sides.map((x) => [x.side, x.blob]), [['front', 'f2'], ['back', 'b1']]);
  assert.deepEqual(Object.keys(out.sides[0]).sort(), ['blob', 'checks', 'height', 'quad', 'side', 'width']);
  s = redo(s, 'front'); assert.equal(s.step, 0); assert.equal(s.phase, 'capturing');
  assert.throws(() => result(s)); assert.throws(() => accept(createSession())); assert.deepEqual(STEPS, ['front', 'back']);
});

test('session ids are random hex', () => {
  assert.notEqual(createSession().sessionId, createSession().sessionId);
  assert.match(createSession().sessionId, /^[0-9a-f]{32}$/);
});
