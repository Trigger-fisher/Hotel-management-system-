import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGalleryFile, sniff, pdfPages, MAX_BYTES } from '../src/gallery.js';

const bytes = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic')]);

test('types come from the first bytes, not from a name', () => {
  assert.equal(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniff(bytes('\x89PNG\r\n\x1a\n....')), 'png');
  assert.equal(sniff(bytes('RIFF....WEBPVP8 ')), 'webp');
  assert.equal(sniff(heic), 'heic');
  assert.equal(sniff(bytes('%PDF-1.7\n')), 'pdf');
  assert.equal(sniff(bytes('MZ\x90\x00')), null);
  assert.equal(sniff(bytes('<svg xmlns=')), null);
});

test('HEIC, JPEG, PNG and PDF are accepted; others are refused with plain sentences', () => {
  assert.equal(checkGalleryFile(heic).ok, true);
  assert.equal(checkGalleryFile(bytes('%PDF-1.4 1 0 obj << /Type /Page >>')).ok, true);
  const bad = checkGalleryFile(bytes('GIF89a....'));
  assert.deepEqual([bad.ok, bad.code], [false, 'unsupported_type']);
});

test('the 25 MB and 20 page caps', () => {
  assert.equal(checkGalleryFile(Uint8Array.from([0xff, 0xd8, 0xff]), MAX_BYTES + 1).code, 'file_too_large');
  const pages = '%PDF-1.4\n' + Array.from({ length: 21 }, (_, i) => `${i} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`).join('') + '1 0 obj << /Type /Pages >> endobj';
  assert.equal(pdfPages(bytes(pages)), 21);
  assert.equal(checkGalleryFile(bytes(pages)).code, 'too_many_pages');
});
