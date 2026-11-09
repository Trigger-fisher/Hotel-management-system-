'use client';

// My profile: the person's photo with Add / Change / Remove (every login: staff, company, guest). A round picture, or the initials when there is none.
import { useRef, useState } from 'react';

import { errorText, useToast } from '@/components/ui';
import { Bi, Button } from '@/dashboards/pallav/ui';
import { apiMode } from '@/lib/api/mode';
import { photoCopy, removeMyPhoto, uploadMyPhoto, useMyPhoto } from './profilePhoto';

import { tr, trf } from '@/lib/i18n/language';
export function ProfilePhotoEditor({ name, initials, className = '' }: { name: string; initials: string; className?: string }) {
  const toast = useToast();
  const photo = useMyPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    const res = await uploadMyPhoto(file);
    setBusy(false);
    if (res.ok) toast.show({ tone: 'success', text: photoCopy.saved });
    else setError('sentence' in res ? res.sentence : (res.error.details?.fields?.photo ?? errorText(res.error)));
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await removeMyPhoto();
    setBusy(false);
    if (res.ok) toast.show({ tone: 'success', text: photoCopy.removed });
    else setError(errorText(res.error));
  };

  return (
    <div className={`pp-editor ${className}`.trim()}>
      <div className="pp-photo">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in picture from the API (or a data URL in the preview); next/image would fetch it without the session
          <img src={photo} alt={trf("Photo of {0}", [name])} />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
        {/* check-shared-ignore: the round camera badge on the photo, a shortcut to Change */}
        <button type="button" className="pp-cam" aria-label={photo ? 'Change your photo' : 'Add a photo'} title={photo ? 'Change your photo' : 'Add a photo'} disabled={busy} onClick={() => input.current?.click()}>
          <Bi name="camera" />
        </button>
      </div>
      <div className="pp-actions">
        <Button size="sm" variant="outline" icon="upload" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? tr("Saving…") : photo ? tr("Change photo") : tr("Add a photo")}
        </Button>
        {photo ? (
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => void remove()}>
            {tr("Remove")}
          </Button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
      <p className="pp-hint">{apiMode() === 'real' ? tr("JPG, PNG or WebP, up to 10 MB.") : photoCopy.mockNote}</p>
      {error ? (
        <p className="pp-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}