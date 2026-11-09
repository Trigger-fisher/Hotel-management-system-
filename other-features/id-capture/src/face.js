/**
 * Optional face-presence hint on the FRONT side (the side that carries the portrait). It only uses the browser's own
 * Shape Detection API (`FaceDetector`, built into Chromium on Android, ChromeOS and macOS): nothing is downloaded, bundled
 * or licensed, and the picture never leaves the phone. Where the browser has no FaceDetector (iPhone Safari, Firefox,
 * desktop Chrome without the flag) the hint is skipped and nothing is shown.
 *
 * A third-party detector (for example MediaPipe Face Detector, Apache-2.0) was NOT added: it needs a WebAssembly runtime and
 * a model file fetched at run time, which breaks this folder's no-dependency rule. The server's photo check is the real
 * gate ("Photo on the ID is not clear, please retake."); this is a hint so the guest can retake at once.
 *
 * FACE_MIN_PX (40) is COPIED from intake-worker on 2026-11-05: a face box shorter than this in source pixels is too small.
 */
export const FACE_LIMITS = { minFacePx: 40 };

export const FACE_MESSAGES = {
  noFace: 'No photo found on the front. Retake with the whole front in view.',
  faceSmall: 'The photo on the ID is too small. Move closer.',
};

/** True when this browser can run the hint. */
export const faceHintSupported = () => typeof globalThis.FaceDetector === 'function';

/**
 * Pure decision: { code, message } from detected faces ([{ boundingBox: { height } }], as FaceDetector returns them) on
 * a front side. `faces === null` means "not checked" and gives no hint.
 */
export function faceAdvice(faces, side = 'front') {
  if (side !== 'front' || faces === null || faces === undefined) return { code: '', message: '' };
  if (!faces.length) return { code: 'noFace', message: FACE_MESSAGES.noFace };
  const tallest = Math.max(...faces.map((f) => (f.boundingBox ? f.boundingBox.height : 0)));
  if (tallest < FACE_LIMITS.minFacePx) return { code: 'faceSmall', message: FACE_MESSAGES.faceSmall };
  return { code: '', message: '' };
}

let detector = null;

/**
 * Faces on an image source (canvas, ImageBitmap, img), or null when unsupported or when the detector fails. Created lazily
 * on first use. `Detector` can be passed in for tests.
 */
export async function detectFaces(source, Detector = globalThis.FaceDetector) {
  if (typeof Detector !== 'function') return null;
  try {
    if (!detector || detector.constructor !== Detector) detector = new Detector({ fastMode: true, maxDetectedFaces: 3 });
    return await detector.detect(source);
  } catch {
    return null;
  }
}
