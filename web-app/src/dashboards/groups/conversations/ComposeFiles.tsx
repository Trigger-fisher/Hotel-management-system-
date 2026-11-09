'use client';

// The files of an email being written (MJ, 2 Nov 2026), for both Compose windows. Each file is checked by Gmail's rules (25 MB in all, no program or script file) and sent straight to the
// private bucket while the person keeps writing; a chip shows its size and progress. Send waits for the uploads. The email carries the files as ordinary attachments, and an hour
// after it went they are removed from the bucket.
import { useRef, useState } from 'react';

import type { ConversationsApi } from '@shared/dashboards/conversations';
import { MAIL_FILES_MAX_BYTES, MAIL_FILES_MAX_COUNT, mailFileProblem, mailFileSize } from '@shared/dashboards/mailFiles';

import { Bi, IconButton } from '@/dashboards/pallav/ui';

interface Item {
  key: string;
  name: string;
  size: number;
  state: 'uploading' | 'ready' | 'failed';
  percent: number;
  ref?: string;
  error?: string;
}

export function useComposeFiles(api: Pick<ConversationsApi, 'addEmailFile'>) {
  const [items, setItems] = useState<Item[]>([]);
  const counter = useRef(0);
  const patch = (key: string, change: Partial<Item>) => setItems((l) => l.map((x) => (x.key === key ? { ...x, ...change } : x)));

  const add = (list: FileList | null) => {
    if (!api.addEmailFile || !list) return;
    let total = items.filter((x) => x.state !== 'failed').reduce((s, x) => s + x.size, 0);
    let count = items.filter((x) => x.state !== 'failed').length;
    for (const file of Array.from(list)) {
      const key = `f${(counter.current += 1)}`;
      const base: Item = { key, name: file.name, size: file.size, state: 'uploading', percent: 0 };
      const problem = mailFileProblem(file.name, file.size) ?? (count >= MAIL_FILES_MAX_COUNT ? `An email can carry ${MAIL_FILES_MAX_COUNT} files at most.` : total + file.size > MAIL_FILES_MAX_BYTES ? `${file.name} would take the email over 25 MB.` : null);
      if (problem) {
        setItems((l) => [...l, { ...base, state: 'failed', error: problem }]);
        continue;
      }
      total += file.size;
      count += 1;
      setItems((l) => [...l, base]);
      void api.addEmailFile(file, (percent) => patch(key, { percent })).then((r) => {
        if (r.ok) patch(key, { state: 'ready', percent: 100, ref: r.data.ref });
        else patch(key, { state: 'failed', error: r.error.details?.fields?.attachments ?? r.error.message });
      });
    }
  };

  return {
    enabled: Boolean(api.addEmailFile),
    items,
    /** What Compose sends: the files that finished uploading. */
    refs: items.flatMap((x) => (x.state === 'ready' && x.ref ? [x.ref] : [])),
    uploading: items.some((x) => x.state === 'uploading'),
    add,
    remove: (key: string) => setItems((l) => l.filter((x) => x.key !== key)),
    clear: () => setItems([]),
  };
}

export type ComposeFiles = ReturnType<typeof useComposeFiles>;

/** The paperclip that opens the file picker. Shown only when the inbox can carry files. */
export function AttachButton({ files, label, className }: { files: ComposeFiles; label: string; className?: string }) {
  if (!files.enabled) return null;
  return (
    <label className={className ?? 'btn-icon gm-attach'} title={label}>
      <Bi name="paperclip" />
      <input type="file" multiple hidden onChange={(e) => { files.add(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

/** The files so far: name, size and progress; a refused file says why. */
export function FileChips({ files, removeLabel }: { files: ComposeFiles; removeLabel: string }) {
  if (files.items.length === 0) return null;
  return (
    <ul className="cv-compose-files">
      {files.items.map((x) => (
        <li key={x.key} className={`cv-file is-${x.state}`} title={x.error}>
          <Bi name={x.state === 'failed' ? 'exclamation-triangle' : 'paperclip'} />
          <span className="cv-file-name">{x.name}</span>
          <span className="cv-file-meta">{x.state === 'failed' ? x.error : x.state === 'uploading' ? `${x.percent}%` : mailFileSize(x.size)}</span>
          {x.state === 'uploading' ? <progress className="cv-file-bar" max={100} value={x.percent} aria-label={x.name} /> : null}
          <IconButton icon="x-lg" label={removeLabel} onClick={() => files.remove(x.key)} />
        </li>
      ))}
    </ul>
  );
}
