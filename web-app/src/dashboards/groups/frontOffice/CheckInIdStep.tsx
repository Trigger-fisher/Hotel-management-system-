'use client';
// Step 1 of the check-in once a booking or a walk-in is picked: the ID first. The pictures are chosen (a card's two sides, or the cards of several people), read in
// one go, and the form below stays hidden until the ID is read or the desk chooses to type it in. A reading stays on screen until the reader answers or the person cancels;
// a failure stays until the person acts on it, and the chosen pictures are kept through all of it.
import { useEffect, useRef, useState } from 'react';

import { Bi, Button } from '../../pallav/ui';
import { ID_READ_MAX_PICTURES, idReadProblem } from './idPhoto';

import { tr } from '@/lib/i18n/language';
export type IdPhase = 'ask' | 'reading' | 'rejected' | 'failed' | 'done';
/** Why a reading failed: the reader is off for this hotel, it is busy, or something else went wrong. */
export type IdFailure = 'off' | 'busy' | 'error';
export interface IdState {
  phase: IdPhase;
  /** The reader's own line for an unclear photo, or why nothing was read. */
  message?: string;
  /** Form fields the reader did not fill; each shows "Not read, please fill" until it has a value. */
  unread: string[];
  /** True when the form was filled by the reader (false when the desk chose to type it in, or came back to a saved draft). */
  fromId?: boolean;
  /** The pictures chosen so far; they stay through reading, a failure and a retake. */
  files: File[];
  /** While reading: 'prepare' (the pictures are made ready) or 'wait' (the reader has them). */
  stage?: 'prepare' | 'wait';
  failure?: IdFailure;
}
export const ID_ASK: IdState = { phase: 'ask', unread: [], files: [] };

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** The chosen pictures plus the new ones (a repeat is skipped, at most 8 are kept); `problem` says what was left out. */
export function addPictures(current: File[], incoming: File[]): { files: File[]; problem: string | null } {
  const files = [...current];
  let problem: string | null = null;
  for (const f of incoming) {
    const bad = idReadProblem(f);
    if (bad) { problem = `${f.name}: ${bad}`; continue; }
    if (files.some((x) => sameFile(x, f))) continue;
    if (files.length >= ID_READ_MAX_PICTURES) { problem = 'You can add up to 8 pictures. The first 8 were kept.'; break; }
    files.push(f);
  }
  return { files, problem };
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="ci-id-secs">{seconds} s</span>;
}

function Pictures({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="ci-id-files" aria-label={tr("Pictures chosen")}>
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${f.lastModified}`}>
          <Bi name="image" />
          <span className="ci-id-file">{f.name}</span>
          <button type="button" className="ci-id-x" onClick={() => onRemove(i)} aria-label={`${tr("Remove")} ${f.name}`}><Bi name="x-lg" /></button>
        </li>
      ))}
    </ul>
  );
}

function Reading({ state, onCancel }: { state: IdState; onCancel: () => void }) {
  const wait = state.stage === 'wait';
  return (
    <div className="ci-id-reading" role="status" aria-live="polite">
      <ol className="ci-id-stages">
        <li className={wait ? 'is-done' : 'is-now'}><Bi name={wait ? 'check-circle-fill' : 'arrow-repeat'} /> {tr("Preparing the pictures")}</li>
        <li className={wait ? 'is-now' : ''}><Bi name={wait ? 'arrow-repeat' : 'circle'} /> {tr("Reading the name and number")} {wait && <Elapsed />}</li>
      </ol>
      <p className="ci-id-hint">{tr("This can take up to half a minute. You can cancel and type it in yourself.")}</p>
      <Button variant="outline" icon="x-lg" onClick={onCancel}>{tr("Cancel")}</Button>
    </div>
  );
}

interface Props {
  state: IdState;
  walkIn: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (i: number) => void;
  onRead: () => void;
  onCancel: () => void;
  onSkip: () => void;
}

export function CheckInIdStep({ state, walkIn, onAdd, onRemove, onRead, onCancel, onSkip }: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (list.length) onAdd(list);
  };
  const reading = state.phase === 'reading';
  const failed = state.phase === 'failed';
  const rejected = state.phase === 'rejected';
  const n = state.files.length;
  const again = failed && state.failure !== 'off';
  return (
    <div
      className={`card ci-id${rejected || failed ? ' is-rejected' : ''}${over ? ' is-over' : ''}`}
      onDragOver={(e) => { if (!reading) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!reading && e.dataTransfer.files.length) onAdd(Array.from(e.dataTransfer.files)); }}
    >
      <span className="ci-id-ic" aria-hidden="true"><Bi name="person-vcard" /></span>
      <h6 className="ci-id-title">{reading ? tr("Reading the ID") : failed ? tr("The ID was not read") : rejected ? tr("This photo cannot be used") : tr("Add the guest's ID")}</h6>
      {reading && <Reading state={state} onCancel={onCancel} />}
      {!reading && failed && <p className="ci-id-retake" role="alert">{tr(state.message ?? "The ID could not be read just now. Try again, or type it in yourself.")}</p>}
      {!reading && rejected && <p className="ci-id-retake" role="alert">{state.message ? tr(state.message) : tr("Retake the photo of the card.")}</p>}
      {!reading && !failed && !rejected && (
        <p className="ci-id-text">
          {state.message ? tr(state.message) : walkIn ? tr("Take a photo of the ID. The guest's name, number and address fill in by themselves.") : tr("Take a photo of the ID. The booking's details are kept and the rest fills in by itself.")}
        </p>
      )}
      <Pictures files={state.files} onRemove={onRemove} />
      {!reading && (
        <>
          {!failed && <p className="ci-id-hint">{tr("Add the front and back of a card, or the cards of several people. Up to 8 pictures, 8 MB each.")}</p>}
          {failed ? (
            <div className="ci-id-acts">
              {again && n > 0 && <Button icon="arrow-repeat" onClick={onRead}>{tr("Try again")}</Button>}
              <Button variant={again && n > 0 ? 'outline' : undefined} icon={state.failure === 'off' ? 'chevron-right' : 'keyboard'} onClick={onSkip}>{state.failure === 'off' ? tr("Continue") : tr("Type it in myself")}</Button>
            </div>
          ) : (
            <div className="ci-id-acts">
              {n > 0 && <Button icon="search" onClick={onRead}>{tr("Read the ID")} ({n})</Button>}
              <Button variant={n > 0 ? 'outline' : undefined} icon="camera" onClick={() => camera.current?.click()}>{n > 0 ? tr("Add another photo") : rejected ? tr("Take the photo again") : tr("Take a photo of the ID")}</Button>
              <Button variant="outline" icon="upload" onClick={() => files.current?.click()}>{tr("Choose files")}</Button>
            </div>
          )}
          <input ref={camera} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={pick} aria-label={tr("Take a photo of the ID")} />
          <input ref={files} type="file" accept="image/jpeg,image/png" multiple hidden onChange={pick} aria-label={tr("Choose files")} />
          {!failed && <button type="button" className="ci-id-skip" onClick={onSkip}>{tr("Skip, type it in myself")}</button>}
        </>
      )}
    </div>
  );
}
