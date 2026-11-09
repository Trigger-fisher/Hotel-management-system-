// Client-side image fitting for the website uploads: a picked photo, logo or icon is made small enough for the server
// (at most 4 MB per image on hosted media) before it is sent. The browser decodes the picture (EXIF orientation applied),
// draws it smaller on a canvas and encodes it again, best quality first, until the file is under the limit.
// The pure part (planFit and the helpers above it) has no browser dependency and is unit tested; fitImage itself needs a
// browser (createImageBitmap / OffscreenCanvas, with an <img> and <canvas> fallback) and is checked by hand.
// No imports on purpose: the tests load this file under plain `node --test`.

/**
 * What the browser sends at most per picture: 3 MB. The server takes 4 MB per image, but a picture travels as base64 inside JSON (4/3 of its size) and a hosted
 * platform refuses a request over about 4.5 MB, so 3 MB (4.2 MB as base64) is the most that always fits one request.
 */
export const FIT_MAX_BYTES = 3_145_728;
/** The longest side a photo keeps; larger pictures are drawn smaller even when the file is already small enough. */
export const FIT_MAX_SIDE = 2560;
/** Below this longest side the plan gives up (the picture would be useless). */
export const FIT_MIN_SIDE = 320;
/** Each step down draws the longest side about 15% smaller. */
export const FIT_STEP = 0.85;
/** JPEG qualities tried at each size, best first. */
export const FIT_QUALITIES: readonly number[] = [0.9, 0.8, 0.7];

export type FitOutputType = 'image/jpeg' | 'image/png';
export interface FitAttempt {
  /** Longest side in pixels of this attempt. */
  side: number;
  type: FitOutputType;
  /** JPEG quality (0-1); absent for PNG. */
  quality?: number;
}

export type FitErrorCode = 'TOO_LARGE' | 'NOT_IMAGE';
export type FitImageError = Error & { code: FitErrorCode; /** false = a kind of file that is sent as it is (SVG, GIF, ICO), so it cannot be made smaller. */ shrinkable: boolean };

export function fitError(code: FitErrorCode, shrinkable: boolean, message: string): FitImageError {
  return Object.assign(new Error(message), { code, shrinkable });
}

export function isFitError(e: unknown): e is FitImageError {
  return e instanceof Error && ((e as FitImageError).code === 'TOO_LARGE' || (e as FitImageError).code === 'NOT_IMAGE');
}

/**
 * How a picked file is treated: 'raster' = decoded and resized when needed; 'asIs' = SVG, GIF (may be animated) and ICO are sent
 * untouched (only the size is checked); 'unknown' = not a picture.
 */
export function fileKind(type: string, name: string): 'raster' | 'asIs' | 'unknown' {
  const t = type.toLowerCase();
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  if (t === 'image/svg+xml' || t === 'image/gif' || t === 'image/x-icon' || t === 'image/vnd.microsoft.icon' || ['svg', 'gif', 'ico'].includes(ext)) return 'asIs';
  if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'].includes(ext)) return 'raster';
  return 'unknown';
}

/** Types the server stores as they are; anything else (BMP, HEIC, AVIF, ...) is always re-encoded. */
export function keepsType(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

/** "Lobby photo.HEIC" -> "Lobby photo.jpg" (an extension is added when there is none). */
export function renameFor(name: string, type: FitOutputType): string {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

/** Width and height drawn for a longest side (aspect kept, never upscaled, at least 1 px). */
export function sizeFor(width: number, height: number, side: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = Math.min(1, side / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The longest sides tried: min(original, maxSide), then about 15% smaller each step, down to minSide (the first is always tried). */
export function sideSteps(longest: number, maxSide = FIT_MAX_SIDE, minSide = FIT_MIN_SIDE, step = FIT_STEP): number[] {
  const start = Math.max(1, Math.round(Math.min(longest, maxSide)));
  const out = [start];
  for (let s = Math.floor(start * step); s >= minSide && s < out[out.length - 1]!; s = Math.floor(s * step)) out.push(s);
  return out;
}

export interface FitPlanInput {
  /** Decoded size (after EXIF orientation). */
  width: number;
  height: number;
  /** The picked file's size and type. */
  bytes: number;
  type: string;
  /** The picture has see-through pixels (only matters for PNG / WebP). */
  hasAlpha: boolean;
  maxBytes?: number;
  maxSide?: number;
  minSide?: number;
}

export interface FitPlan {
  /** true = send the picked file as it is. */
  passThrough: boolean;
  /** The encodes to try, in order; the first one under the limit is sent. */
  attempts: FitAttempt[];
}

/**
 * The pure plan of fitImage. A file already under the limit, not wider than maxSide and of a type the server keeps is sent as it is.
 * Otherwise: a PNG or WebP with see-through pixels first tries PNG at every step (a logo keeps its transparency at a smaller size),
 * then JPEG; everything else is JPEG. At each longest side JPEG tries quality 0.9, then 0.8, then 0.7 before stepping down.
 */
export function planFit(i: FitPlanInput): FitPlan {
  const maxBytes = i.maxBytes ?? FIT_MAX_BYTES;
  const maxSide = i.maxSide ?? FIT_MAX_SIDE;
  const minSide = Math.min(i.minSide ?? FIT_MIN_SIDE, maxSide);
  const longest = Math.max(i.width, i.height);
  const type = i.type.toLowerCase();
  if (i.bytes <= maxBytes && longest <= maxSide && keepsType(type)) return { passThrough: true, attempts: [] };
  const sides = sideSteps(longest, maxSide, minSide);
  const attempts: FitAttempt[] = [];
  if (i.hasAlpha && (type === 'image/png' || type === 'image/webp')) for (const side of sides) attempts.push({ side, type: 'image/png' });
  for (const side of sides) for (const quality of FIT_QUALITIES) attempts.push({ side, type: 'image/jpeg', quality });
  return { passThrough: false, attempts };
}

// ---------------------------------------------------------------- browser part (checked by hand)

type Drawable = ImageBitmap | HTMLImageElement;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(width, height);
      if (c.getContext('2d')) return c;
    } catch {
      /* fall back to a DOM canvas */
    }
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function ctxOf(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d') as Ctx2D | null;
  if (!ctx) throw fitError('NOT_IMAGE', true, 'No 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

function encode(c: AnyCanvas, type: FitOutputType, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => (c as HTMLCanvasElement).toBlob((b) => resolve(b), type, quality));
}

/** Decodes the file with its EXIF orientation applied: createImageBitmap first, then an <img> (browsers orient those by default). */
async function decode(file: File): Promise<{ img: Drawable; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    for (const opts of [{ imageOrientation: 'from-image' } as ImageBitmapOptions, undefined]) {
      try {
        const b = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
        return { img: b, width: b.width, height: b.height, close: () => b.close() };
      } catch {
        /* try the next way */
      }
    }
  }
  if (typeof document === 'undefined') throw fitError('NOT_IMAGE', true, 'Cannot decode');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('decode');
    return { img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    throw fitError('NOT_IMAGE', true, 'Cannot decode');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Whether any pixel is see-through (checked on a copy at most 512 px wide, enough for logos and cut-outs). */
function seeThrough(img: Drawable, width: number, height: number): boolean {
  const { width: w, height: h } = sizeFor(width, height, 512);
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let p = 3; p < data.length; p += 4) if (data[p]! < 255) return true;
  } catch {
    return true; // cannot look: keep PNG in the plan, it costs only a few tries
  }
  return false;
}

/** Draws the picture at the given size; big reductions go down in halves first so the result stays sharp. */
function draw(img: Drawable, width: number, height: number, toW: number, toH: number, opaque: boolean): AnyCanvas {
  let src: Drawable | AnyCanvas = img;
  let sw = width;
  let sh = height;
  while (sw / 2 >= toW && sh / 2 >= toH) {
    const nw = Math.round(sw / 2);
    const nh = Math.round(sh / 2);
    const half = makeCanvas(nw, nh);
    ctxOf(half).drawImage(src, 0, 0, nw, nh);
    src = half;
    sw = nw;
    sh = nh;
  }
  const out = makeCanvas(toW, toH);
  const ctx = ctxOf(out);
  if (opaque) {
    // JPEG has no transparency: see-through parts become white, not black.
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, toW, toH);
  }
  ctx.drawImage(src, 0, 0, toW, toH);
  return out;
}

/**
 * Makes a picked image fit the upload limit. Returns the file to send and whether it was redrawn, or throws a FitImageError:
 * NOT_IMAGE when the browser cannot read it as a picture, TOO_LARGE when even the smallest try is over the limit (or an SVG / GIF /
 * ICO, which is sent as it is, is over the limit; shrinkable is then false).
 */
export async function fitImage(file: File, opts?: { maxBytes?: number; maxSide?: number }): Promise<{ file: File; resized: boolean }> {
  const maxBytes = opts?.maxBytes ?? FIT_MAX_BYTES;
  const maxSide = opts?.maxSide ?? FIT_MAX_SIDE;
  const kind = fileKind(file.type, file.name);
  if (kind === 'unknown') throw fitError('NOT_IMAGE', true, 'Not an image');
  if (kind === 'asIs') {
    if (file.size > maxBytes) throw fitError('TOO_LARGE', false, 'Too large and cannot be made smaller');
    return { file, resized: false };
  }
  const pic = await decode(file);
  try {
    const type = file.type.toLowerCase();
    const alphaPossible = type === 'image/png' || type === 'image/webp';
    const plan = planFit({
      width: pic.width, height: pic.height, bytes: file.size, type,
      // Only looked at when a redraw is needed and the type can carry transparency.
      hasAlpha: alphaPossible && (file.size > maxBytes || Math.max(pic.width, pic.height) > maxSide) ? seeThrough(pic.img, pic.width, pic.height) : false,
      maxBytes, maxSide,
    });
    if (plan.passThrough) return { file, resized: false };
    let canvas: AnyCanvas | null = null;
    let drawn = '';
    for (const a of plan.attempts) {
      const { width, height } = sizeFor(pic.width, pic.height, a.side);
      const key = `${width}x${height}:${a.type}`;
      if (key !== drawn) {
        canvas = draw(pic.img, pic.width, pic.height, width, height, a.type === 'image/jpeg');
        drawn = key;
      }
      const blob = canvas ? await encode(canvas, a.type, a.quality) : null;
      // Some browsers silently encode PNG when asked for another type; only the type asked for counts.
      if (blob && blob.size > 0 && blob.size <= maxBytes && blob.type === a.type) {
        return { file: new File([blob], renameFor(file.name, a.type), { type: a.type, lastModified: file.lastModified }), resized: true };
      }
    }
    throw fitError('TOO_LARGE', true, 'Still too large after resizing');
  } finally {
    pic.close();
  }
}
