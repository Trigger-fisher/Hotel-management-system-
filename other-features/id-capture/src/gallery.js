/**
 * Files chosen from the GALLERY (not the camera): which types are accepted and the caps, decided from the first bytes
 * (never the name). A convenience for instant feedback only; the worker checks everything again.
 */
import { compressionCheck } from './jpeg.js';

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 20;
export const ACCEPT_ATTRIBUTE = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

const ascii = (b, from, to) => String.fromCharCode(...b.slice(from, to));

/** 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | null, from the first bytes. */
export function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-')) return 'pdf';
  if (ascii(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(ascii(bytes, 8, 12))) return 'heic';
  return null;
}

/** Rough page count of a PDF by counting page objects in the readable text (compressed object streams may hide some). */
export function pdfPages(bytes) {
  const text = Array.from({ length: Math.ceil(bytes.length / 32768) }, (_, i) => String.fromCharCode(...bytes.subarray(i * 32768, (i + 1) * 32768))).join('');
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
}

/**
 * { ok, code, message, kind, warning } for a file chosen from the gallery. `bytes` = Uint8Array of the whole file.
 * A JPEG also gets `compression` (src/jpeg.js) and, when it is compressed, a `warning` sentence: the file is still
 * accepted (the worker grades it), but the guest is asked for the original at once.
 */
export function checkGalleryFile(bytes, size = bytes.length) {
  if (size > MAX_BYTES) return { ok: false, code: 'file_too_large', message: 'The file is larger than 25 MB.' };
  const kind = sniff(bytes);
  if (!kind) return { ok: false, code: 'unsupported_type', message: 'Only JPEG, PNG, WebP, HEIC and PDF files are accepted.' };
  if (kind === 'pdf' && pdfPages(bytes) > MAX_PAGES) return { ok: false, code: 'too_many_pages', message: 'The PDF has more than 20 pages.' };
  if (kind === 'jpeg') {
    const compression = compressionCheck(bytes, size);
    return { ok: true, code: 'ok', message: '', kind, compression, warning: compression.message };
  }
  return { ok: true, code: 'ok', message: '', kind, warning: '' };
}

/** Ask the browser for a JPEG where it can: canvas.toBlob(cb, 'image/jpeg', 0.92) is used for camera captures. */
export const PREFERRED_CAPTURE_TYPE = 'image/jpeg';
