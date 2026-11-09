'use client';

// The guest's ID photo (main guest only; members have none): read in the browser as base64 for PUT /front-office/stays/{id}/id-photo. The server checks the
// real content (JPG or PNG) and takes at most 4 MB per image, so a bigger picture is shrunk here first (kept as a colour JPEG under 3 MB (about 4 MB as base64, inside a hosted platform's 4.5 MB request limit)).
// Nothing is kept here.
export const ID_PHOTO_SEND_BYTES = 3_000_000;
const PICK_MAX_BYTES = 40 * 1024 * 1024;

export type PickedIdPhoto = { ok: true; fileName: string; dataBase64: string } | { ok: false; error: string };

const unreadable: PickedIdPhoto = { ok: false, error: 'That file could not be read. Pick it again.' };

function toBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const comma = text.indexOf(',');
      resolve(comma < 0 ? null : text.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Shrinks a picture until its JPEG is under the limit: first the quality, then the size. Null when the browser cannot decode it. */
async function shrink(file: File, limit: number): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.85;
  try {
    for (let i = 0; i < 10; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // check-shared-ignore: a JPEG has no transparency, so the canvas is filled white whatever the theme; this is picture data, not a UI colour
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
      if (blob && blob.size <= limit) return blob;
      if (quality > 0.6) quality -= 0.1;
      else scale *= 0.8;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** How many pictures one reading takes, and the biggest one (the check is on the file before it is shrunk). */
export const ID_READ_MAX_PICTURES = 8;
export const ID_READ_MAX_BYTES = 8 * 1024 * 1024;
/** All the pictures of one reading together stay inside the hosting platform's request limit, so each gets its share. */
export const idReadShare = (count: number): number => Math.floor(ID_PHOTO_SEND_BYTES / Math.max(1, count));

/** The picture's message when it cannot be used for the reading, or null. */
export function idReadProblem(file: File): string | null {
  if (!/\.(jpe?g|png)$/i.test(file.name) && !/^image\/(jpeg|png)$/.test(file.type)) return 'Pick a JPG or PNG image.';
  if (file.size > ID_READ_MAX_BYTES) return 'That file is too big (8 MB at most).';
  return null;
}

export async function readIdPhoto(file: File, maxBytes: number = ID_PHOTO_SEND_BYTES): Promise<PickedIdPhoto> {
  if (!/\.(jpe?g|png)$/i.test(file.name) && !/^image\/(jpeg|png)$/.test(file.type)) return { ok: false, error: 'Pick a JPG or PNG image.' };
  if (file.size > PICK_MAX_BYTES) return { ok: false, error: 'That file is too big.' };
  if (file.size <= maxBytes) {
    const data = await toBase64(file);
    return data === null ? unreadable : { ok: true, fileName: file.name, dataBase64: data };
  }
  const small = await shrink(file, maxBytes);
  const data = small ? await toBase64(small) : null;
  return data === null ? unreadable : { ok: true, fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', dataBase64: data };
}
