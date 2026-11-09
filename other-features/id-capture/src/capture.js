/**
 * Thin DOM glue: camera, outline overlay, auto-capture, preview with Retake. All decisions live in the pure
 * modules. Nothing is uploaded here: the caller receives { sessionId, sides } through onDone.
 *
 * Before anything leaves the phone the guest sees, at once: blur, darkness and glare per frame; "card too far" (under
 * 150 dpi in the full picture, auto-capture waits); for a gallery file its type and caps, a heavy-compression warning
 * for JPEGs, and a multi-card hint (several cards are fine, up to 12; too small -> "photograph 4 or fewer"); and on the
 * front side, where the browser has a built-in face detector, a "no photo found" hint.
 */
import { detectQuad, detectQuadCv, loadOpenCv } from './detect.js';
import { quadArea, warpQuad } from './geometry.js';
import { quickChecks } from './checks.js';
import { cardDpi, findCards, multiCardAdvice } from './cards.js';
import { detectFaces, faceAdvice, faceHintSupported } from './face.js';
import { ACCEPT_ATTRIBUTE, checkGalleryFile } from './gallery.js';
import { SteadyDetector } from './steady.js';
import { accept, captured, createSession, label, redo, result, retake } from './steps.js';

export async function startCapture(root, { onDone, openCvUrl = '', framesNeeded = 12, faceHint = true } = {}) {
  root.innerHTML = `
    <div class="idc"><p class="idc-step"></p><div class="idc-stage"><video playsinline muted></video><canvas class="idc-overlay"></canvas></div>
    <p class="idc-hint"></p><div class="idc-actions"><button class="idc-shoot">Take photo now</button>
    <label class="idc-fallback">Use the camera app<input class="idc-camera-file" type="file" accept="image/*" capture="environment" hidden></label>
    <label class="idc-fallback">Choose from gallery<input class="idc-gallery-file" type="file" accept="${ACCEPT_ATTRIBUTE}" hidden></label></div>
    <div class="idc-review" hidden><canvas class="idc-preview"></canvas><p class="idc-review-hint"></p><button class="idc-retake">Retake</button><button class="idc-accept">Use this</button></div></div>`;
  const $ = (s) => root.querySelector(s);
  const video = $('video'), overlay = $('.idc-overlay'), hint = $('.idc-hint'), stepText = $('.idc-step'), reviewHint = $('.idc-review-hint');
  const work = document.createElement('canvas'), steady = new SteadyDetector({ framesNeeded });
  let session = createSession(), stream = null, cv = null, running = false, last = null;

  const show = () => { stepText.textContent = label(session); $('.idc-review').hidden = session.phase !== 'reviewing'; $('.idc-stage').hidden = session.phase === 'reviewing'; };
  const currentSide = () => (session.step === 0 ? 'front' : 'back');

  async function openCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      video.srcObject = stream; await video.play(); return true;
    } catch { hint.textContent = 'The camera could not be opened. Use the camera app button instead.'; return false; }
  }

  function frame() {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    work.width = Math.round(video.videoWidth * scale); work.height = Math.round(video.videoHeight * scale);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, work.width, work.height);
    return ctx.getImageData(0, 0, work.width, work.height);
  }

  function draw(quad, progress) {
    overlay.width = work.width; overlay.height = work.height;
    const g = overlay.getContext('2d'); g.clearRect(0, 0, overlay.width, overlay.height);
    if (!quad) return;
    g.lineWidth = 4; g.strokeStyle = progress >= 1 ? '#22c55e' : '#facc15';
    g.beginPath(); quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  }

  /** Show the review screen with its hints; on the front, add the face hint when the browser can run it. */
  async function review(entry, previewSource, extra = [], { many = false } = {}) {
    if (session.phase === 'reviewing') session = retake(session);  // a new file replaces the one on screen
    session = captured(session, entry);
    const p = $('.idc-preview'); p.width = entry.width || previewSource.width; p.height = entry.height || previewSource.height;
    p.getContext('2d').drawImage(previewSource, 0, 0, p.width, p.height);
    const lines = [...extra, ...(entry.checks.messages || [])].filter(Boolean);
    reviewHint.textContent = lines.join(' ');
    hint.textContent = '';
    show();
    if (faceHint && faceHintSupported() && currentSide() === 'front' && !many) {
      const advice = faceAdvice(await detectFaces(previewSource), 'front');
      entry.checks.faceHint = advice.code || 'ok';
      if (advice.message && session.phase === 'reviewing') reviewHint.textContent = [...lines, advice.message].join(' ');
    }
  }

  function capture(fromFrame, quad) {
    const full = document.createElement('canvas'); full.width = video.videoWidth; full.height = video.videoHeight;
    full.getContext('2d').drawImage(video, 0, 0);
    const image = full.getContext('2d').getImageData(0, 0, full.width, full.height);
    const k = full.width / fromFrame.width;
    const bigQuad = quad ? quad.map(([x, y]) => [x * k, y * k]) : [[0, 0], [full.width, 0], [full.width, full.height], [0, full.height]];
    const flat = warpQuad(image, bigQuad);
    const out = document.createElement('canvas'); out.width = flat.width; out.height = flat.height;
    out.getContext('2d').putImageData(new ImageData(flat.data, flat.width, flat.height), 0, 0);
    out.toBlob((blob) => {
      const share = quad ? quadArea(quad) / (fromFrame.width * fromFrame.height) : 1;
      const checks = quickChecks(flat, share, { cardDpi: quad ? cardDpi(bigQuad).dpi : null });
      review({ blob, width: flat.width, height: flat.height, quad: quad ? bigQuad : null, checks }, out);
    }, 'image/jpeg', 0.92);
  }

  function loop() {
    if (!running) return;
    if (session.phase === 'capturing' && video.videoWidth) {
      const f = frame(), found = cv ? detectQuadCv(cv, f) : detectQuad(f);
      const quad = found ? found.quad : null;
      const share = quad ? quadArea(quad) / (f.width * f.height) : 0;
      const k = video.videoWidth / f.width;  // the card's resolution is judged in the full-size picture
      const checks = quickChecks(f, share, { cardDpi: quad ? cardDpi(quad.map(([x, y]) => [x * k, y * k])).dpi : null });
      const state = steady.push(quad, checks.pass, { width: f.width, height: f.height });
      draw(quad, state.progress);
      hint.textContent = quad ? checks.messages[0] || 'Hold still...' : 'Place the document inside the frame.';
      last = { f, quad };
      if (state.steady) { steady.reset(); capture(f, quad); }
    }
    requestAnimationFrame(loop);
  }

  /** A file from the camera app or the gallery: type and caps, compression, cards in it, then the usual checks. */
  async function useFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const gallery = checkGalleryFile(bytes, file.size);
    if (!gallery.ok) { hint.textContent = gallery.message; return; }
    const pass = { pass: true, failed: [], messages: [] };
    let bitmap = null;
    if (gallery.kind !== 'pdf') { try { bitmap = await createImageBitmap(file); } catch { bitmap = null; } }
    if (!bitmap) {  // a PDF, or a HEIC this browser cannot show: the worker converts and checks it
      if (session.phase === 'reviewing') session = retake(session);
      session = captured(session, { blob: file, width: 0, height: 0, quad: null, checks: { ...pass, gallery } });
      reviewHint.textContent = gallery.warning || 'This file is checked after upload.'; show(); return;
    }
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
    const image = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const cards = findCards(image), advice = multiCardAdvice(cards);
    if (cards.length > 1) {  // several cards: keep the whole picture, the worker cuts them apart
      const checks = quickChecks(image, 1);
      checks.cards = cards.length; checks.advice = advice; checks.gallery = gallery;
      if (advice.level === 'reject') { checks.pass = false; checks.failed.push(advice.code); }
      c.toBlob((blob) => review({ blob, width: c.width, height: c.height, quad: null, checks }, c, [gallery.warning, advice.message], { many: true }), 'image/jpeg', 0.92);
      return;
    }
    const found = detectQuad(image);
    const quad = found ? found.quad : cards.length ? cards[0].quad : [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]];
    const flat = warpQuad(image, quad), out = document.createElement('canvas'); out.width = flat.width; out.height = flat.height;
    out.getContext('2d').putImageData(new ImageData(flat.data, flat.width, flat.height), 0, 0);
    const checks = quickChecks(flat, 1, { cardDpi: found || cards.length ? cardDpi(quad).dpi : null });
    checks.advice = advice; checks.gallery = gallery;
    const extra = [gallery.warning, checks.failed.includes('cardTooFar') || advice.code === 'cardTooFar' ? '' : advice.message];
    out.toBlob((blob) => review({ blob, width: flat.width, height: flat.height, quad, checks }, out, extra), 'image/jpeg', 0.92);
  }

  $('.idc-shoot').onclick = () => last && capture(last.f, last.quad);
  $('.idc-retake').onclick = () => { session = retake(session); steady.reset(); reviewHint.textContent = ''; show(); };
  $('.idc-accept').onclick = () => {
    session = accept(session); steady.reset(); reviewHint.textContent = ''; show();
    if (session.phase === 'done') { running = false; stream && stream.getTracks().forEach((t) => t.stop()); onDone && onDone(result(session)); }
  };
  for (const sel of ['.idc-camera-file', '.idc-gallery-file']) {
    $(sel).onchange = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) await useFile(file); };
  }

  show();
  if (openCvUrl) loadOpenCv(openCvUrl).then((loaded) => { cv = loaded; });  // lazy: never blocks the camera
  running = await openCamera();
  if (running) requestAnimationFrame(loop);
  return { redo: (side) => { session = redo(session, side); show(); }, stop: () => { running = false; stream && stream.getTracks().forEach((t) => t.stop()); } };
}
