'use client';

// A printable document is a real PDF made by the server (PDF_ROUTES in ui-shared/dashboards/common.ts). It opens in a new tab.
// The tab is opened first, inside the click, so the browser does not block it; the file is then fetched with the session, and if the server
// answers with its normal JSON error instead of a PDF, the tab is closed and the sentence is shown as a toast.
import type { ReactNode } from 'react';

import { overviewCopy } from '@shared/dashboards/overview';
import { useToast } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { Bi } from '../Bi';

/**
 * Real mode: opens the server's PDF in a new tab. Mock mode: there is no PDF server, so `onInfo` says so and the browser's print view of the
 * page on screen opens instead (`hms-overrides.css` prints only the report).
 */
export async function openPdf(url: string, onError: (sentence: string) => void, onInfo?: (sentence: string) => void): Promise<void> {
  if (apiMode() === 'mock') {
    onInfo?.(overviewCopy.reports.pdfMock);
    // Let the toast paint first, then open the print view.
    window.setTimeout(() => window.print(), 300);
    return;
  }
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('pdf')) {
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      if (tab) tab.location.href = href;
      else window.location.href = href;
      // The new tab has read it by now; free the memory a minute later.
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      return;
    }
    tab?.close();
    let sentence = 'The document could not be made. Try again.';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) sentence = body.error.message;
    } catch {
      /* not JSON */
    }
    onError(sentence);
  } catch {
    tab?.close();
    onError('The document could not be reached. Check the connection and try again.');
  }
}

/** The "View" button of a row: Pallav's `btn btn-sm btn-outline-p` with the PDF icon. */
export function PdfButton({ url, label = 'View', title, className = 'btn btn-sm btn-outline-p', children }: { url: string; label?: string; title?: string; className?: string; children?: ReactNode }) {
  const toast = useToast();
  return (
    <button type="button" className={className} title={title ?? 'Open the PDF'} onClick={() => void openPdf(url, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }))}>
      {children ?? (
        <>
          <Bi name="file-earmark-pdf" /> {label}
        </>
      )}
    </button>
  );
}
