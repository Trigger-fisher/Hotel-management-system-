'use client';

// "Hotels on this number" (MJ, 4 Nov 2026): which hotels use the SHARED guest number and the code of each (the word a guest can type, like "sunrise: is breakfast included?", to reach that hotel). Super
// Admin and Platform Admin attach a hotel from the list, change its code, or detach it (its chats stay where they are). Shown on the shared number's card.
import { useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';

import { Alert, Button, Field, Modal, Skeleton, StatusChip } from '@/dashboards/pallav/ui';

import { whatsappAdminApi, whatsappAdminAvailable, type WaLineHotels } from './whatsappAdminApi';

const errorOf = (e: DashError): string => (e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message);

/** The link that opens a chat on the shared number with the hotel's code already typed (a hotel puts it on its website or prints it). Null without a code or a known number. */
export const chatLinkOf = (phone: string | null, code: string | null): string | null => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 && code ? `https://wa.me/${digits}?text=${encodeURIComponent(`${code}: `)}` : null;
};

export function WhatsAppLineHotels({ lineId, phone }: { lineId: string; phone: string | null }) {
  const [data, setData] = useState<WaLineHotels | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [newCode, setNewCode] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [qr, setQr] = useState<{ name: string; link: string } | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

  // the picture is drawn here in the browser (the library loads only when a QR code is asked for): nothing about the hotel or the link leaves the page
  useEffect(() => {
    let on = true;
    if (!qr) return;
    void import('qrcode')
      .then((m) => m.toDataURL(qr.link, { errorCorrectionLevel: 'M', margin: 2, width: 512 }))
      .then((url) => on && setQrImage(url))
      .catch(() => on && setQrImage(null));
    return () => {
      on = false;
      setQrImage(null);
    };
  }, [qr]);

  useEffect(() => {
    let on = true;
    void whatsappAdminApi.lineHotels(lineId).then((r) => {
      if (!on) return;
      if (r.ok) setData(r.data);
      else setNote({ tone: 'danger', text: errorOf(r.error) });
    });
    return () => {
      on = false;
    };
  }, [lineId, attempt]);

  const refresh = (): void => setAttempt((n) => n + 1);
  if (!data) return note ? <Alert tone="danger">{note.text}</Alert> : <Skeleton rows={1} />;

  return (
    <div className="mt-2" style={{ borderTop: '1px solid var(--bs-border-color, #2a2a2a)', paddingTop: 8, textAlign: 'left' }}>
      {!whatsappAdminAvailable() ? (
        <Alert tone="info" className="mb-2">
          Sample data for the preview: nothing here is saved.
        </Alert>
      ) : null}
      {note ? (
        <Alert tone={note.tone} className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>}>
          {note.text}
        </Alert>
      ) : null}
      <div className="fs-hint mb-1">A guest picks a hotel by typing its code first (for example &ldquo;sunrise: is breakfast included?&rdquo;), or by tapping the &ldquo;Chat with the hotel&rdquo; button on a message the hotel sent.</div>
      {data.attached.length === 0 ? <div className="fs-hint">No hotel uses this number yet.</div> : null}
      {data.attached.map((h) => (
        <div key={h.hotelId} className="d-flex flex-wrap align-items-center gap-2 py-1">
          <strong style={{ minWidth: 200 }}>{h.hotelName}</strong>
          <input className="form-control form-control-sm" style={{ width: 160 }} aria-label={`Code of ${h.hotelName}`} value={codes[h.hotelId] ?? h.hotelCode ?? ''} onChange={(e) => setCodes((c) => ({ ...c, [h.hotelId]: e.target.value }))} placeholder="code" />
          <Button
            size="sm"
            variant="outline"
            busy={busy === `c-${h.hotelId}`}
            disabled={(codes[h.hotelId] ?? h.hotelCode ?? '') === (h.hotelCode ?? '')}
            onClick={async () => {
              setBusy(`c-${h.hotelId}`);
              const r = await whatsappAdminApi.setHotelCode(lineId, h.hotelId, (codes[h.hotelId] ?? '').trim() || null);
              setBusy(null);
              if (r.ok) {
                setNote({ tone: 'success', text: `The code of ${h.hotelName} is saved.` });
                setCodes((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== h.hotelId)));
                refresh();
              } else setNote({ tone: 'danger', text: errorOf(r.error) });
            }}
          >
            Save code
          </Button>
          {h.hotelCode ? <StatusChip>Guests type: {h.chatText}</StatusChip> : <StatusChip tone="warn">No code</StatusChip>}
          {chatLinkOf(phone, h.hotelCode) ? (
            <Button
              size="sm"
              variant="outline"
              icon="link-45deg"
              onClick={() => void navigator.clipboard?.writeText(chatLinkOf(phone, h.hotelCode) as string).then(() => setNote({ tone: 'success', text: `The chat link of ${h.hotelName} is copied. Put it on the hotel's website or print it as a QR code.` }))}
            >
              Copy chat link
            </Button>
          ) : null}
          {chatLinkOf(phone, h.hotelCode) ? (
            <Button size="sm" variant="outline" icon="qr-code" onClick={() => setQr({ name: h.hotelName, link: chatLinkOf(phone, h.hotelCode) as string })}>
              QR code
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger"
            icon="x-circle"
            busy={busy === `d-${h.hotelId}`}
            onClick={async () => {
              setBusy(`d-${h.hotelId}`);
              const r = await whatsappAdminApi.detachHotel(lineId, h.hotelId);
              setBusy(null);
              if (r.ok) {
                setNote({ tone: 'success', text: `${h.hotelName} no longer uses this number. Its chats stay where they are.` });
                refresh();
              } else setNote({ tone: 'danger', text: errorOf(r.error) });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Modal open={qr !== null} onClose={() => setQr(null)} title={qr ? `QR code of ${qr.name}` : 'QR code'} size="sm" footer={<Button variant="ghost" onClick={() => setQr(null)}>Close</Button>}>
        {qr ? (
          <div className="text-center">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- a picture drawn in this browser from the chat link
              <img src={qrImage} alt={`QR code that opens a WhatsApp chat with ${qr.name}`} style={{ width: 256, height: 256, background: '#fff' }} />
            ) : (
              <Skeleton rows={1} />
            )}
            <div className="fs-hint mt-2">A guest who scans it opens a chat with {qr.name} on WhatsApp. Print it or put it on the hotel&rsquo;s website.</div>
            {qrImage ? (
              <a className="btn btn-sm btn-outline-secondary mt-2" href={qrImage} download={`whatsapp-${qr.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}>
                Download the picture
              </a>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <div className="row g-2 mt-1 align-items-end">
        <Field label="Add a hotel" col="col-md-5">
          <select className="form-select form-select-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a hotel</option>
            {data.available.map((h) => (
              <option key={h.hotelId} value={h.hotelId}>
                {h.hotelName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Its code (leave empty to make one)" col="col-md-4" optional>
          <input className="form-control form-control-sm" value={newCode} onChange={(e) => setNewCode(e.target.value)} maxLength={24} />
        </Field>
        <div className="col-md-3">
          <Button
            size="sm"
            icon="plus-circle"
            busy={busy === 'add'}
            disabled={pick === ''}
            onClick={async () => {
              setBusy('add');
              const r = await whatsappAdminApi.attachHotel(lineId, pick, newCode.trim() || null);
              setBusy(null);
              if (r.ok) {
                setNote({ tone: 'success', text: `${r.data.hotelName} now uses this number. Its code is "${r.data.hotelCode}".` });
                setPick('');
                setNewCode('');
                refresh();
              } else setNote({ tone: 'danger', text: errorOf(r.error) });
            }}
          >
            Add hotel
          </Button>
        </div>
      </div>
    </div>
  );
}
