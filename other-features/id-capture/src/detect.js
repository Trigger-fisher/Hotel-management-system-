/**
 * Document outline detection on a downscaled frame.
 *  - detectQuad(): pure JavaScript fallback (difference from the border colour, biggest blob, extreme corners).
 *  - detectQuadCv(): the better path when OpenCV.js is loaded (Canny + contours + approxPolyDP). Written for the
 *    browser; it is not exercised by the Node tests because OpenCV.js is not bundled.
 */
import { orderCorners, quadScore } from './geometry.js';
import { percentile, toGray } from './checks.js';

const WORK_SIDE = 320;

export function detectQuad(image) {
  const { gray, w, h } = toGray(image, WORK_SIDE);
  const scale = image.width / w;
  const border = [], t = Math.max(2, Math.floor(0.04 * Math.min(w, h)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) border.push(gray[y * w + x]);
  const background = percentile(border, 0.5);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = Math.abs(gray[i] - background) > 30 ? 1 : 0;
  const seen = new Uint8Array(w * h), stack = [];
  let best = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0, tl = start, br = start, tr = start, bl = start;
    const key = (p) => { const x = p % w, y = (p - x) / w; return [x + y, y - x]; };
    let [kTl] = key(start), kBr = kTl, [, kTr] = key(start), kBl = kTr;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      if (x + y < kTl) { kTl = x + y; tl = p; }
      if (x + y > kBr) { kBr = x + y; br = p; }
      if (y - x < kTr) { kTr = y - x; tr = p; }
      if (y - x > kBl) { kBl = y - x; bl = p; }
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!best || size > best.size) best = { size, corners: [tl, tr, br, bl] };
  }
  if (!best || best.size < 0.1 * w * h) return null;
  const quad = orderCorners(best.corners.map((p) => [((p % w) + 0.5) * scale, (Math.floor(p / w) + 0.5) * scale]));
  const frame = { width: image.width, height: image.height };
  const score = quadScore(quad, frame);
  return score >= 0.4 ? { quad, score } : null;
}

export function detectQuadCv(cv, image) {
  const src = cv.matFromImageData(image), gray = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 60, 160);
    cv.dilate(edges, edges, cv.Mat.ones(3, 3, cv.CV_8U));
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let best = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i), peri = cv.arcLength(c, true), approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const quad = orderCorners(Array.from({ length: 4 }, (_, k) => [approx.data32S[k * 2], approx.data32S[k * 2 + 1]]));
        const score = quadScore(quad, { width: image.width, height: image.height });
        if (!best || score > best.score) best = { quad, score };
      }
      approx.delete(); c.delete();
    }
    return best && best.score >= 0.4 ? best : null;
  } finally {
    src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
}

/** Lazy OpenCV.js loader. The file is NOT bundled (about 8-10 MB): pass the URL you host. Resolves to cv, or null on failure. */
export async function loadOpenCv(url, timeoutMs = 20000) {
  if (!url || typeof document === 'undefined') return null;
  if (globalThis.cv && globalThis.cv.Mat) return globalThis.cv;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    const cv = globalThis.cv instanceof Promise ? await globalThis.cv : globalThis.cv;
    if (cv && cv.Mat) return cv;
    return await new Promise((resolve) => { cv.onRuntimeInitialized = () => resolve(cv); setTimeout(() => resolve(null), timeoutMs); });
  } catch {
    return null; // the pure JavaScript detector keeps working
  }
}
