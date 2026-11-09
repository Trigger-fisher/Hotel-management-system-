import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBytes, checkFile, sniff, findDangerousPdfParts } from './fileCheck.js';

const enc = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const pdf = (body) => enc(`%PDF-1.7\n1 0 obj\n<< ${body} >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`);

test('real type comes from bytes, not from a name', async () => {
  assert.equal(sniff(PNG), 'png');
  const file = new File([PNG], 'holiday.pdf', { type: 'application/pdf' });
  const r = await checkFile(file);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'png');
});

test('plain text and executables are refused', () => {
  assert.equal(checkBytes(enc('hello world')).code, 'unsupported_type');
  assert.equal(checkBytes(enc('MZ\x90\x00\x03')).code, 'unsupported_type');
});

test('empty and oversized files are refused', () => {
  assert.equal(checkBytes(new Uint8Array(0)).code, 'empty_file');
  assert.equal(checkBytes(PNG, { maxBytes: 5 }).code, 'too_large');
});

test('a clean pdf passes', () => {
  const r = checkBytes(pdf('/Type /Catalog /Pages 2 0 R'));
  assert.deepEqual([r.ok, r.kind], [true, 'pdf']);
});

for (const name of ['JS', 'JavaScript', 'Launch', 'OpenAction', 'AA', 'EmbeddedFile', 'RichMedia', 'XFA', 'SubmitForm', 'GoToR']) {
  test(`pdf with /${name} is refused`, () => {
    const r = checkBytes(pdf(`/Type /Catalog /${name} 3 0 R`));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pdf_dangerous_content');
    assert.ok(r.found.includes(name));
  });
}

test('hex-escaped names cannot hide', () => {
  const r = checkBytes(pdf('/Type /Catalog /Java#53cript 3 0 R'));
  assert.equal(r.code, 'pdf_dangerous_content');
});

test('names that merely start the same are not flagged', () => {
  assert.deepEqual(findDangerousPdfParts(pdf('/AAPL 1 /JSON 2 /Authors 3')), []);
});

test('encrypted pdf is refused', () => {
  const r = checkBytes(pdf('/Type /Catalog /Encrypt 5 0 R'));
  assert.equal(r.code, 'pdf_encrypted');
});

test('checkFile refuses by size before reading', async () => {
  const r = await checkFile({ size: 10, arrayBuffer: async () => { throw new Error('should not read'); } }, { maxBytes: 5 });
  assert.equal(r.code, 'too_large');
});
