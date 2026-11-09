/**
 * Browser quick filter for uploads.
 *
 * THIS IS A CONVENIENCE, NEVER SECURITY. Anyone can skip this code and send bytes straight to
 * the server, so a pass here proves nothing. Its only job is to give an honest visitor a fast,
 * friendly "no" before a large upload starts. The real protection is server side: quarantine
 * bucket -> scanner service (ClamAV + disarm and rebuild) -> clean bucket.
 *
 * No dependencies. Works in browsers and in Node (node --test).
 */

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

// PDF names that mean "this file can run or fetch something". Matched after un-hiding #xx escapes.
export const DANGEROUS_PDF_NAMES = [
  'JS', 'JavaScript', 'Launch', 'OpenAction', 'AA', 'EmbeddedFile', 'EmbeddedFiles',
  'RichMedia', 'XFA', 'SubmitForm', 'GoToR',
];

const ok = (kind) => ({ ok: true, code: 'ok', message: 'The file looks fine.', kind });
const no = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

const startsWith = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b, from, to) => String.fromCharCode(...b.slice(from, to));

/** Real type from the first bytes. Never trusts the file name or the browser's content type. */
export function sniff(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 2) === 'BM' && bytes.slice(6, 10).every((v) => v === 0)) return 'bmp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-')) return 'pdf';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis' || ascii(bytes, 8, 64).includes('avif')) return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

/** Names found in the PDF text. Escapes such as /J#53 are decoded first, so they cannot hide. */
export function findDangerousPdfParts(bytes) {
  let text = '';
  const step = 1 << 15;
  for (let i = 0; i < bytes.length; i += step) text += String.fromCharCode(...bytes.subarray(i, i + step));
  text = text.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const found = DANGEROUS_PDF_NAMES.filter((n) => new RegExp(`/${n}(?![A-Za-z0-9])`).test(text));
  if (/\/Encrypt(?![A-Za-z0-9])/.test(text)) found.push('Encrypt');
  return found;
}

/** Check bytes you already hold. Returns { ok, code, message, kind, found? }. */
export function checkBytes(bytes, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (bytes.length === 0) return no('empty_file', 'The file is empty.');
  if (bytes.length > maxBytes) return no('too_large', 'The file is too large.');
  const kind = sniff(bytes);
  if (kind === null) return no('unsupported_type', 'Only PDF and picture files are accepted.');
  if (kind === 'pdf') {
    const found = findDangerousPdfParts(bytes);
    if (found.includes('Encrypt')) return no('pdf_encrypted', 'Password-protected PDFs are not accepted.', { kind, found });
    if (found.length) return no('pdf_dangerous_content', 'This PDF contains active content and cannot be accepted.', { kind, found });
  }
  return ok(kind);
}

/** Check a File or Blob chosen in the browser. */
export async function checkFile(file, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (file.size > maxBytes) return no('too_large', 'The file is too large.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return checkBytes(bytes, { maxBytes });
}
