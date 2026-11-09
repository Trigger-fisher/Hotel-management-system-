'use client';

// The signed-in person's own profile photo (B's contract in admin.ts: GET /profile carries photoUrl; PUT / DELETE profilePhotoPath). One small store for the whole tab, so
// the sidebar chip, the top-bar user menu, the phone More sheet and My profile show the same picture and change together. The real server is read once when the
// dashboard opens; the mock keeps an uploaded picture in this page only (a data URL), so the preview can be tried.
import { PROFILE_PHOTO_MAX_BYTES, profilePhotoPath, type ProfilePhotoState } from '@shared/dashboards/admin';
import type { DashResult } from '@shared/dashboards/common';

import * as client from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';
import { adminApi } from './api';
import { setMyPhoto, useMyPhoto } from '../../shell/myPhoto';

const set = setMyPhoto;
export { setMyPhoto, useMyPhoto };

let loaded = false;
/** Reads the photo once per tab from GET /profile (real server only). */
export function loadMyPhoto(): void {
  if (loaded || apiMode() !== 'real') return;
  loaded = true;
  void adminApi.getProfile().then((r) => {
    if (r.ok) set(r.data.photoUrl ?? null);
    else loaded = false;
  });
}

const PATH = profilePhotoPath.replace(/^\/api\/v1/, '');

export const photoCopy = {
  tooBig: 'The picture is larger than 10 MB. Choose a smaller one.',
  wrongType: 'Choose a JPG, PNG or WebP picture.',
  saved: 'Your photo is saved.',
  removed: 'Your photo is removed.',
  mockNote: 'Preview: the photo is kept in this page only.',
};

/** Checks, reads and uploads a picture; answers the new state or a sentence. */
export async function uploadMyPhoto(file: File): Promise<DashResult<ProfilePhotoState> | { ok: false; sentence: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, sentence: photoCopy.wrongType };
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return { ok: false, sentence: photoCopy.tooBig };
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  if (apiMode() !== 'real') {
    set(dataUrl);
    return { ok: true, data: { hasPhoto: true, photoUrl: dataUrl } };
  }
  const res = await client.put<ProfilePhotoState>(PATH, { fileName: file.name, dataBase64: dataUrl.replace(/^data:[^,]*,/, '') });
  if (res.ok) set(res.data.photoUrl);
  return res;
}

export async function removeMyPhoto(): Promise<DashResult<ProfilePhotoState>> {
  if (apiMode() !== 'real') {
    set(null);
    return { ok: true, data: { hasPhoto: false, photoUrl: null } };
  }
  const res = await client.del<ProfilePhotoState>(PATH);
  if (res.ok) set(null);
  return res;
}