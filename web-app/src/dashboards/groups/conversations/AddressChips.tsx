'use client';

// The people of an email thread as small chips (the chat view): the conversation's participants under its heading, the To and Cc lines of one message, and the Cc box of
// the reply as a row of chips that can be added to (type an address, Enter, comma or a paste) and removed from. A chip shows the name; a click shows the full address.
// Every address and name is rendered as text (React escapes it); nothing here is read from a mail body.
import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { conversationsCopy as c } from '@shared/dashboards/conversations';

import { Bi } from '@/dashboards/pallav/ui';

import { addressOf, ccSuggestions, looksLikeAddress, nameOf, splitAddresses, type ThreadPerson } from './emailThread';

/** One person as a chip. A click shows the full address (and hides it again); `mark` is the small tag, e.g. "Cc". */
export function AddressChip({ raw, mark }: { raw: string; mark?: string }) {
  const [full, setFull] = useState(false);
  const address = addressOf(raw);
  const name = nameOf(raw);
  const label = name.toLowerCase() === address ? address : name;
  const named = label.toLowerCase() !== address;
  return (
    <button /* check-shared-ignore: a person chip shows its full address on a click (no kit equivalent) */ type="button" className={`cv-chip${full ? ' is-full' : ''}`} title={address} aria-expanded={named ? full : undefined} onClick={() => setFull((v) => !v)}>
      <span className="cv-chip-name">{label}</span>
      {full && named ? <span className="cv-chip-addr">{address}</span> : null}
      {mark ? <span className="cv-chip-mark">{mark}</span> : null}
    </button>
  );
}

/** "To: a b c" or "Cc: a b": a label and its chips on one wrapping line. */
export function PeopleLine({ label, list }: { label: string; list: string[] }) {
  if (list.length === 0) return null;
  return (
    <div className="cv-people-line">
      <span className="cv-people-label">{label}</span>
      {list.map((p, i) => (
        <AddressChip key={`${addressOf(p)}-${i}`} raw={p} />
      ))}
    </div>
  );
}

/** Under the conversation heading: the contact and everyone else on the thread; a person who was only ever Cc'd carries the "Cc" mark. */
export function ParticipantStrip({ people }: { people: ThreadPerson[] }) {
  if (people.length < 2) return null;
  return (
    <div className="cv-people" role="group" aria-label={c.email.people}>
      <Bi name="people" />
      {people.map((p) => (
        <AddressChip key={p.address} raw={p.name === p.address ? p.address : `${p.name} <${p.address}>`} mark={p.ccOnly ? c.email.ccMark : undefined} />
      ))}
    </div>
  );
}

/**
 * The Cc box of the reply: chips and a line to type in. Enter, a comma, a semicolon, a space or leaving the line turns the typed text into a chip when it is an address
 * (a pasted list becomes several); anything else stays for the person to fix. Backspace on an empty line removes the last chip. The suggestions are the thread's people.
 */
export function CcChipsInput({
  id,
  value,
  onChange,
  people,
  known = [],
  target,
  max,
  disabled,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  people: ThreadPerson[];
  known?: readonly string[];
  /** The address the reply goes to (not offered again in Cc). */
  target: string | null;
  max: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const add = (raw: string[]) => {
    let next = [...value];
    let say: string | null = null;
    for (const a of raw) {
      if (!looksLikeAddress(a)) {
        say = c.reply.ccBad.replace('{address}', a);
        continue;
      }
      if (next.some((x) => x.toLowerCase() === a.toLowerCase())) continue;
      if (next.length >= max) {
        say = c.reply.ccLimit.replace('{n}', String(max));
        break;
      }
      next = [...next, a];
    }
    setNote(say);
    if (next.length !== value.length) onChange(next);
    return say === null;
  };
  // the text becomes chips; what is not an address stays in the line
  const commit = () => {
    const pieces = splitAddresses(typed);
    if (pieces.length === 0) return;
    add(pieces);
    setTyped(pieces.filter((p) => !looksLikeAddress(p)).join(' '));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      if (typed.trim()) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Enter') e.preventDefault();
    } else if (e.key === 'Backspace' && !typed && value.length) onChange(value.slice(0, -1));
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[,;\s]/.test(text.trim())) return;
    e.preventDefault();
    add(splitAddresses(`${typed} ${text}`));
    setTyped('');
  };
  const offer = disabled || value.length >= max ? [] : ccSuggestions(typed, value, people, known, target);
  return (
    <div className="cv-ccbox">
      <div className={`cv-ccfield${invalid ? ' is-invalid' : ''}`}>
        {value.map((a) => (
          <span key={a} className="cv-chip is-edit">
            <span className="cv-chip-name" title={a}>{a}</span>
            <button /* check-shared-ignore: removes one Cc chip (a chip's own small button) */ type="button" className="cv-chip-x" disabled={disabled} aria-label={c.reply.ccRemove.replace('{address}', a)} onClick={() => onChange(value.filter((x) => x !== a))}>
              <Bi name="x" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          className="cv-ccinput"
          value={typed}
          disabled={disabled || value.length >= max}
          placeholder={value.length ? '' : c.reply.ccPlaceholder}
          aria-label={c.reply.cc}
          onChange={(e) => {
            setTyped(e.target.value);
            setNote(null);
          }}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={commit}
        />
      </div>
      {offer.length ? (
        <div className="cv-ccoffer" role="group" aria-label={c.reply.ccSuggested}>
          {offer.map((p) => (
            <button /* check-shared-ignore: a suggested person is added to Cc with one touch (a chip-shaped button) */ key={p.address} type="button" className="cv-chip is-offer" title={p.address} onMouseDown={(e) => e.preventDefault()} onClick={() => { add([p.address]); setTyped(''); }}>
              <Bi name="plus" />
              <span className="cv-chip-name">{p.name === p.address ? p.address : p.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {note ? <div className="field-error">{note}</div> : null}
    </div>
  );
}
