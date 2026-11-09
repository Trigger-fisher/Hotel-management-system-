'use client';

// The report pages' "Download PDF" (reports/index.blade.php: <a class="btn btn-p" target="_blank" href="reports.download">).
// openPdf handles both modes: the server's PDF with the session in real mode, the print view with a note in mock mode.
import { useToast } from '@/components/ui';
import { Bi, openPdf } from '@/dashboards/pallav/ui';

import { tr } from '@/lib/i18n/language';
export function ReportPdfLink({ url }: { url: string }) {
  const toast = useToast();
  return (
    <a
      className="btn btn-p"
      target="_blank"
      rel="noreferrer"
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void openPdf(url, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }));
      }}
    >
      <Bi name="file-earmark-pdf" /> {tr("Download PDF")}
    </a>
  );
}
