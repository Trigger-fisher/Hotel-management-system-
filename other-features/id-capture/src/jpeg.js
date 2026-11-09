/**
 * Heavy-compression warning for JPEGs chosen from the gallery (chat apps and "save as small" re-compress pictures and smear
 * the print). Read from the file's own bytes, before anything decodes or re-saves it: the size from the frame header (SOF),
 * the quality from the luminance quantisation table (DQT), and the file's bytes per pixel.
 *
 * The quality estimate and the two limits (25 heavy, 45 compressed) are COPIED from intake-worker on 2026-11-05 (its
 * clarity check uses the same libjpeg scale and the same limits), so the phone warns where the server would grade the
 * picture down. Nothing is imported from another folder. A convenience only: the worker checks everything again.
 */

/** The standard libjpeg luminance table (Annex K of the JPEG standard), natural order. */
export const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_LUMA_SUM = STD_LUMA.reduce((a, b) => a + b, 0);

export const JPEG_LIMITS = {
  qualityHeavy: 25, // copied from intake-worker CLARITY_JPEG_Q_UNCLEAR
  qualityWarn: 45, // copied from intake-worker CLARITY_JPEG_Q_USABLE
  // Only used when no quantisation table can be read. A phone photo at quality 90 is about 0.3-0.5 bytes per pixel; a chat
  // app copy about 0.1; a picture squeezed to quality 20 about 0.03 (estimates, see README).
  bppHeavy: 0.035,
  bppWarn: 0.07,
};

export const JPEG_MESSAGES = {
  jpegHeavy: 'This picture is too compressed. Send the original or retake it.',
  jpegCompressed: 'This picture looks compressed. The original reads better.',
};

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Walk the JPEG markers up to the first scan. Returns { width, height, progressive, tables: { id: number[64] } } or null
 * when the bytes are not a JPEG or the header is cut short. Never throws.
 */
export function readJpegHeader(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out = { width: 0, height: 0, progressive: false, tables: {} };
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return out.width ? out : null; // lost sync
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < bytes.length) { i++; marker = bytes[i + 1]; } // fill bytes
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || i + 1 >= bytes.length) break;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) break;
    const end = Math.min(bytes.length, i + length);
    if (marker === 0xdb) {
      let p = i + 2;
      while (p < end) {
        const precision = bytes[p] >> 4, id = bytes[p] & 15, size = precision ? 2 : 1;
        p++;
        if (p + 64 * size > end) break;
        const table = new Array(64);
        for (let k = 0; k < 64; k++) table[k] = size === 2 ? (bytes[p + 2 * k] << 8) | bytes[p + 2 * k + 1] : bytes[p + k];
        out.tables[id] = table;
        p += 64 * size;
      }
    } else if (SOF.has(marker) && i + 7 < bytes.length) {
      out.height = (bytes[i + 3] << 8) | bytes[i + 4];
      out.width = (bytes[i + 5] << 8) | bytes[i + 6];
      out.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
    } else if (marker === 0xda) {
      break; // start of scan: everything needed is above it
    }
    i += length;
  }
  return out.width || Object.keys(out.tables).length ? out : null;
}

/** libjpeg-scale quality (1-100, one decimal) from a luminance table; null when there is none. */
export function qualityFromTable(table) {
  if (!table || table.length !== 64) return null;
  const scale = (table.reduce((a, b) => a + b, 0) / STD_LUMA_SUM) * 100;
  const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.round(Math.max(1, Math.min(100, quality)) * 10) / 10;
}

/** The libjpeg table for a quality (what a libjpeg encoder writes, baseline 8-bit). Used by the tests to build headers. */
export function tableForQuality(quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return STD_LUMA.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))));
}

/**
 * { level: 'ok'|'warn'|'heavy'|'unknown', code, message, quality, bytesPerPixel } for a JPEG file. `size` is the file's
 * byte length (defaults to bytes.length). Not a JPEG -> level 'unknown' and no message.
 */
export function compressionCheck(bytes, size = bytes ? bytes.length : 0) {
  const header = readJpegHeader(bytes);
  if (!header) return { level: 'unknown', code: '', message: '', quality: null, bytesPerPixel: null };
  const ids = Object.keys(header.tables).map(Number).sort((a, b) => a - b);
  const quality = ids.length ? qualityFromTable(header.tables[ids[0]]) : null;
  const pixels = header.width * header.height;
  const bytesPerPixel = pixels ? Math.round((size / pixels) * 10000) / 10000 : null;
  let level = 'ok';
  if (quality !== null) {
    if (quality < JPEG_LIMITS.qualityHeavy) level = 'heavy';
    else if (quality < JPEG_LIMITS.qualityWarn) level = 'warn';
  } else if (bytesPerPixel !== null) {
    if (bytesPerPixel < JPEG_LIMITS.bppHeavy) level = 'heavy';
    else if (bytesPerPixel < JPEG_LIMITS.bppWarn) level = 'warn';
  } else {
    level = 'unknown';
  }
  const code = level === 'heavy' ? 'jpegHeavy' : level === 'warn' ? 'jpegCompressed' : '';
  return { level, code, message: code ? JPEG_MESSAGES[code] : '', quality, bytesPerPixel };
}
