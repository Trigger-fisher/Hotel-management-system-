'use client';

// The mail wizard's Email files step (Super Admin): how long the documents added to an email stay in the bucket after the email went.
import { useState } from 'react';

import { MAIL_FILES_KEEP_HOURS_MAX } from '@shared/dashboards/mailFiles';
import { setupCopy, type PlatformSettings } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { platformApi } from './api';
import { actAs } from './PlatformStaff';
import { SetupAsk } from './setupParts';

import { tr } from '@/lib/i18n/language';

const hoursBad = (v: string): string | null => {
  const n = Number(v.trim());
  return v.trim() !== '' && (!/^\d+$/.test(v.trim()) || n < 1 || n > MAIL_FILES_KEEP_HOURS_MAX) ? setupCopy.check.hours(MAIL_FILES_KEEP_HOURS_MAX) : null;
};

export function PlatformMailFiles({ data, user, onSaved, onNext }: { data: PlatformSettings; user: ScreenProps['user']; onSaved: () => void; onNext?: () => void }) {
  const [hours, setHours] = useState(String(data.mailFilesKeepHours));
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const save = () => {
    actAs(user);
    void run(() => platformApi.updatePlatformSettings({ mailFilesKeepHours: Number(hours.trim()) }), {
      success: `${tr('Email files settings saved.')} ${setupCopy.later}`,
      onFields: (f) => setError(f.mailFilesKeepHours ?? ''),
      onOk: () => {
        onSaved();
        onNext?.();
      },
    });
  };
  const same = hours.trim() === String(data.mailFilesKeepHours);
  return (
    <SetupAsk
      id="ps-keep"
      label={tr('Keep files after the send (hours)')}
      hint={`${tr('From 1 to')} ${MAIL_FILES_KEEP_HOURS_MAX}${tr('. A file that was never sent is removed after one day.')}`}
      check={error || hoursBad(hours)}
      go={same && onNext ? { label: setupCopy.continue, icon: 'arrow-right', onClick: onNext } : { label: setupCopy.saveContinue, busy, disabled: same || hours.trim() === '', onClick: save }}
    >
      <input
        id="ps-keep"
        className={`form-control${error || hoursBad(hours) ? ' is-invalid' : ''}`}
        inputMode="numeric"
        maxLength={2}
        value={hours}
        disabled={busy}
        onChange={(e) => {
          setHours(e.target.value.replace(/\D/g, ''));
          setError('');
        }}
      />
    </SetupAsk>
  );
}
