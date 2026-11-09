'use client';

// Building blocks shared by the three Daily Cash screens (web).
import { useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import { cashCopy, istDateOf, istTimeOf, istToday, type CashReceipt, type StampInput } from '@shared/dashboards/cash';

import { Button, Modal, pointText, wordsOf, Table } from '../../pallav/ui';

import { tr } from '@/lib/i18n/language';
const c = cashCopy.common;

/** Keeps the last loaded list, so KPIs and filters stay on screen while the next page loads. */
export function useLastReady<T>(state: { status: string; data?: T }): T | null {
  const [last, setLast] = useState<T | null>(null);
  if (state.status === 'ready' && state.data !== undefined && state.data !== last) setLast(state.data);
  return last;
}

export function stampFromIso(iso: string): StampInput {
  return { date: istDateOf(iso), time: istTimeOf(iso) };
}

export function newStamp(): StampInput {
  return { date: istToday(), time: istTimeOf(new Date().toISOString()) };
}

/**
 * A deposit, voucher or handover sheet in a pop-up. Pallav opens a PDF here; until the server makes these (PDF_ROUTES has no cash route yet)
 * this shows the same facts as the paper would, in Pallav's own table style.
 */
export function ReceiptPreview({ receipt, open, onClose }: { receipt: CashReceipt | null; open: boolean; onClose: () => void }) {
  if (!receipt) return null;
  return (
    <Modal open={open} size="lg" className="pay-form-modal" eyebrow={receipt.kind} title={`${receipt.title} ${receipt.number}`} onClose={onClose}
      footer={<Button onClick={onClose}>{tr("Close")}</Button>}>
      <p className="text-muted small">{c.previewNote}</p>
      <p className="fw-bold mb-2">{receipt.hotelName}</p>
      <Table className="sh-count-table w-100">
        <tbody>
          {receipt.rows.map((r) => (
            <tr key={r.label}><td>{r.label}</td><td className="text-end fw-semibold">{r.value}</td></tr>
          ))}
        </tbody>
      </Table>
      {receipt.lines.length > 0 && (
        <Table className="cb-lines-table mt-3">
          <thead>
            <tr><th>{cashCopy.expenses.category}</th><th>{cashCopy.expenses.item}</th><th className="text-end">{cashCopy.expenses.quantity}</th><th className="text-end">{cashCopy.expenses.price}</th><th className="text-end">{cashCopy.expenses.lineTotal}</th></tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => (
              <tr key={i}><td>{l.category}</td><td className="fw-semibold">{l.item}</td><td className="text-end">{l.quantity}</td><td className="text-end">{l.price}</td><td className="text-end fw-semibold">{l.total}</td></tr>
            ))}
          </tbody>
        </Table>
      )}
      {receipt.showCash && (
        receipt.denominations.length === 0 ? (
          <p className="text-muted small mt-3 mb-0">{cashCopy.handover.noCash}</p>
        ) : (
          <Table className="sh-count-table w-100 mt-3">
            <tbody>
              {receipt.denominations.map((d) => (
                <tr key={d.label}><td>{d.label}</td><td className="text-muted">× {d.count}</td><td className="text-end">{d.total}</td></tr>
              ))}
            </tbody>
          </Table>
        )
      )}
      {receipt.notes.length > 0 && (
        <div className="mt-3">
          <div className="fw-semibold small">{cashCopy.handover.notes}</div>
          <ul className="sh-points">{receipt.notes.map((n, i) => <li key={i}>{pointText(n)}</li>)}</ul>
        </div>
      )}
      {receipt.instructions.length > 0 && (
        <div className="mt-2">
          <div className="fw-semibold small">{cashCopy.handover.instructions}</div>
          <ul className="sh-points warn">{receipt.instructions.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      <div className="fo-total grand mt-3"><span>{receipt.totalLabel}</span><b>{formatINR(receipt.totalPaise)}</b></div>
      <div className="cb-words">{wordsOf(receipt.totalPaise)}</div>
      <div className="d-flex justify-content-between small text-muted mt-3">
        {[receipt.signLeft, receipt.signRight].map((sg) => (
          <span key={sg.label}>{sg.label}: {sg.name}</span>
        ))}
      </div>
    </Modal>
  );
}
