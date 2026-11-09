/** Pure geometry: quad ordering and scoring, steady-quad maths, and a perspective warp. No DOM. */

/** Order four points as top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points) {
  if (points.length !== 4) throw new Error('need four points');
  const bySum = [...points].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDiff = [...points].sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}

export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Width and height of the upright rectangle the quad flattens into (the longer opposite sides). */
export function targetSize(q) {
  return { width: Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))), height: Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))) };
}

/** 0..1: how document-like a quad is in a frame of the given size. 0 means "not plausible". */
export function quadScore(q, frame) {
  if (!isConvex(q)) return 0;
  const share = quadArea(q) / (frame.width * frame.height);
  if (share < 0.15 || share > 0.98) return 0;
  const top = dist(q[0], q[1]), bottom = dist(q[3], q[2]), left = dist(q[0], q[3]), right = dist(q[1], q[2]);
  const sides = (Math.min(top, bottom) / Math.max(top, bottom)) * (Math.min(left, right) / Math.max(left, right));
  const long = Math.max(top + bottom, left + right), short = Math.min(top + bottom, left + right);
  const ratio = long / short;
  if (ratio > 3) return 0;
  const aspect = ratio <= 1.8 ? 1 : 0.6;
  return Math.sqrt(sides) * aspect * Math.min(1, share / 0.3);
}

/** Largest corner movement between two quads, as a share of the frame diagonal. */
export function quadShift(a, b, frame) {
  const diag = Math.hypot(frame.width, frame.height);
  return Math.max(...a.map((p, i) => dist(p, b[i]))) / diag;
}

/** Solve the 3x3 homography that maps the four `from` points to the four `to` points (Gaussian elimination). */
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('degenerate quad');
    [A[col], A[pivot]] = [A[pivot], A[col]]; [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * h[c];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

export function applyHomography(h, [x, y]) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/**
 * Flatten `quad` of `image` (ImageData-like) into an upright rectangle of the source's own resolution (never upscaled
 * beyond `maxSide`). Bilinear sampling. Returns ImageData-like { data, width, height }.
 */
export function warpQuad(image, quad, maxSide = 2400) {
  const q = orderCorners(quad);
  let { width, height } = targetSize(q);
  const shrink = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(8, Math.round(width * shrink)); height = Math.max(8, Math.round(height * shrink));
  const toSource = homography([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], q);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = applyHomography(toSource, [x, y]);
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * sw + x0) * 4 + c], p10 = data[(y0 * sw + x0 + 1) * 4 + c];
        const p01 = data[((y0 + 1) * sw + x0) * 4 + c], p11 = data[((y0 + 1) * sw + x0 + 1) * 4 + c];
        out[o + c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return { data: out, width, height };
}
