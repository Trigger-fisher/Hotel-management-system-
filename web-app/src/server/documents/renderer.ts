import "server-only";
import type { AdvancePreview, BillPreview } from "@shared/dashboards/billing";
import type { CashReceipt } from "@shared/dashboards/cash";
import { AppError } from "../errors";
import { renderAdvance } from "./advance";
import { renderBill } from "./bill";
import { renderCashReceipt } from "./cashReceipt";
import { renderDeadline } from "./kit";
import { renderPayrollDoc, type PayrollDocInput } from "./payrollDoc";

// The ONE port for printable documents (Backend Review/07-PDF-DECISION.md): render(kind, data) -> bytes. One file per kind next to this one; every kind
// takes the SAME data as its preview DTO. Safety: a small queue per process (a month-end burst cannot exhaust memory), a render timeout, a page cap
// (kit.ts), no network and no disk access while rendering (the fonts are read once from the bundle).

export interface RenderedDocument {
  bytes: Uint8Array;
  filename: string;
  pages: number;
  /** The text lines drawn, in order (tests; a caller ignores it). */
  text: string[];
}

export interface DocumentData {
  bill: BillPreview;
  advance: AdvancePreview;
  /** Salary slips, registers, reports, vouchers and letters: the PayrollDoc the screens print. */
  payrollDoc: PayrollDocInput;
  /** The cash book's receipts and the shift handover. */
  cashReceipt: CashReceipt;
}
export type DocumentKind = keyof DocumentData;

export interface DocumentRendererPort {
  render<K extends DocumentKind>(kind: K, data: DocumentData[K]): Promise<RenderedDocument>;
}

const RENDERERS: { [K in DocumentKind]: (data: DocumentData[K]) => Promise<RenderedDocument> } = {
  bill: renderBill,
  advance: renderAdvance,
  payrollDoc: renderPayrollDoc,
  cashReceipt: renderCashReceipt,
};

interface RendererOptions {
  /** Documents drawn at the same time in this process. Default 2. */
  concurrency?: number;
  /** Milliseconds a render may take. Default 15,000. */
  timeoutMs?: number;
  /** Documents allowed to wait for a turn; more are refused. Default 50. */
  maxQueued?: number;
}

export function createDocumentRenderer(options: RendererOptions = {}): DocumentRendererPort {
  const limit = options.concurrency ?? 2;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxQueued = options.maxQueued ?? 50;
  let running = 0;
  const waiting: (() => void)[] = [];

  const turn = async (): Promise<void> => {
    if (running < limit) {
      running += 1;
      return;
    }
    if (waiting.length >= maxQueued) throw new AppError("RATE_LIMITED", "Too many documents are being made right now. Please try again in a moment.", { retryAfterSeconds: 5 });
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return {
    async render(kind, data) {
      await turn();
      let timer: NodeJS.Timeout | undefined;
      try {
        const work = renderDeadline.run(Date.now() + timeoutMs, () => (RENDERERS[kind] as (d: unknown) => Promise<RenderedDocument>)(data));
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AppError("SERVER_ERROR", "The document took too long to make")), timeoutMs);
        });
        return await Promise.race([work, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
        release();
      }
    },
  };
}
