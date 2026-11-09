'use client';

// The hotel's WhatsApp message templates (Settings > WhatsApp), over /api/v1/conversations/whatsapp/templates. In the demo mode the library lives in this page only (sample messages; nothing is saved
// and Meta is pretended: a message sent for approval is approved when it is checked), as the other demo screens do. Every answer is a DashResult.
import type { DashResult } from '@shared/dashboards/common';

import { starterByKey, starterDraft, type StarterMessage } from '@shared/dashboards/whatsappStarters';

import { del, get, patch, post } from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';

export type TemplateCategory = 'utility' | 'authentication' | 'marketing';
export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused';

export interface TemplateVariable {
  index: number;
  name: string;
  example: string;
}

export type TemplateButton = { kind: 'url'; text: string; url: string } | { kind: 'quick_reply'; text: string };

export interface TemplateView {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  variables: TemplateVariable[];
  buttons: TemplateButton[];
  starterKey: string | null;
  status: TemplateStatus;
  statusReason: string | null;
  editable: boolean;
  updatedAt: string;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  variables: TemplateVariable[];
  buttons: TemplateButton[];
  starterKey: string | null;
}

const BASE = '/conversations/whatsapp/templates';
const enc = encodeURIComponent;
const FRESH = { fresh: true } as const;
const NO_KEY = { idempotent: false } as const;
export const templatesLive = (): boolean => apiMode() === 'real';

// ---- the demo ----
const demoOf = (id: string, key: string, status: TemplateStatus, statusReason: string | null, updatedAt: string): TemplateView => {
  const s = starterByKey(key) as StarterMessage;
  return { id, ...starterDraft(s, 'en', { review: 'https://reviews.example.com/your-hotel' }), status, statusReason, editable: status === 'draft' || status === 'rejected', updatedAt };
};
let demo: TemplateView[] = [
  demoOf('demo-1', 'booking_confirmed', 'approved', null, '2026-11-03T10:00:00Z'),
  demoOf('demo-2', 'check_out_thanks', 'rejected', 'Meta asked for the review request to be sent as a marketing message.', '2026-11-03T11:00:00Z'),
];
const nameOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const edit = (t: TemplateView, status: TemplateStatus, reason: string | null = null): TemplateView => ({ ...t, status, statusReason: reason, editable: status === 'draft' || status === 'rejected', updatedAt: new Date().toISOString() });
const demoRun = <T>(work: () => T): Promise<DashResult<T>> => Promise.resolve({ ok: true, data: work() });
const live = <T>(run: () => Promise<DashResult<T>>, sample: () => T): Promise<DashResult<T>> => (templatesLive() ? run() : demoRun(sample));

export const whatsappTemplatesApi = {
  list: () => live(() => get<TemplateView[]>(BASE, undefined, undefined, FRESH), () => demo),
  create: (input: TemplateInput) =>
    live(
      () => post<TemplateView>(BASE, input, NO_KEY),
      () => {
        const made: TemplateView = { id: `demo-${Date.now()}`, ...input, name: nameOf(input.name), status: 'draft', statusReason: null, editable: true, updatedAt: new Date().toISOString() };
        demo = [made, ...demo];
        return made;
      },
    ),
  update: (id: string, input: TemplateInput) =>
    live(
      () => patch<TemplateView>(`${BASE}/${enc(id)}`, input, NO_KEY),
      () => {
        demo = demo.map((t) => (t.id === id ? edit({ ...t, ...input, name: nameOf(input.name) }, 'draft') : t));
        return demo.find((t) => t.id === id) as TemplateView;
      },
    ),
  submit: (id: string) =>
    live(
      () => post<TemplateView>(`${BASE}/${enc(id)}/submit`, {}, NO_KEY),
      () => {
        demo = demo.map((t) => (t.id === id ? edit(t, 'pending') : t));
        return demo.find((t) => t.id === id) as TemplateView;
      },
    ),
  check: (id: string) =>
    live(
      () => post<TemplateView>(`${BASE}/${enc(id)}/check`, {}, NO_KEY),
      () => {
        demo = demo.map((t) => (t.id === id && t.status === 'pending' ? edit(t, 'approved') : t));
        return demo.find((t) => t.id === id) as TemplateView;
      },
    ),
  remove: (id: string) =>
    live(
      () => del<{ removed: true }>(`${BASE}/${enc(id)}`, undefined, NO_KEY),
      () => {
        demo = demo.filter((t) => t.id !== id);
        return { removed: true as const };
      },
    ),
};
