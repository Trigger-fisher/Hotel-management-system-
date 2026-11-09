'use client';

// The hotel's WhatsApp campaigns (Settings > WhatsApp), over /api/v1/conversations/whatsapp/campaigns. In the demo the campaigns live in this page only (sample data; nothing is saved or sent).
import type { DashResult } from '@shared/dashboards/common';

import { del, get, patch, post } from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled';

export interface CampaignView {
  id: string;
  name: string;
  templateId: string;
  templateName: string | null;
  audience: { stayedWithinDays?: number };
  variables: string[];
  status: CampaignStatus;
  statusReason: string | null;
  recipientCount: number;
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  can: { edit: boolean; start: boolean; pause: boolean; resume: boolean; cancel: boolean; remove: boolean };
}

export interface CampaignInput {
  name: string;
  templateId: string;
  audience: { stayedWithinDays?: number };
  variables: string[];
}

const BASE = '/conversations/whatsapp/campaigns';
const enc = encodeURIComponent;
const FRESH = { fresh: true } as const;
const NO_KEY = { idempotent: false } as const;
const liveMode = (): boolean => apiMode() === 'real';

// ---- the demo ----
const can = (status: CampaignStatus): CampaignView['can'] => ({ edit: status === 'draft', start: status === 'draft', pause: status === 'running', resume: status === 'paused', cancel: status === 'running' || status === 'paused', remove: status === 'draft' || status === 'done' || status === 'cancelled' });
let demo: CampaignView[] = [
  { id: 'demo-c1', name: 'Diwali offer', templateId: 'demo-1', templateName: 'booking_confirmed', audience: {}, variables: ['{guest_name}', '12 Nov'], status: 'running', statusReason: null, recipientCount: 120, sent: 45, failed: 1, skipped: 4, waiting: 70, startedAt: '2026-11-04T09:00:00Z', finishedAt: null, createdAt: '2026-11-04T08:30:00Z', can: can('running') },
];
const setDemo = (id: string, status: CampaignStatus): CampaignView => {
  demo = demo.map((c) => (c.id === id ? { ...c, status, can: can(status), statusReason: status === 'paused' ? 'Paused by the hotel.' : null } : c));
  return demo.find((c) => c.id === id) as CampaignView;
};
const live = <T>(run: () => Promise<DashResult<T>>, sample: () => T): Promise<DashResult<T>> => (liveMode() ? run() : Promise.resolve({ ok: true, data: sample() }));

export const whatsappCampaignsApi = {
  list: () => live(() => get<CampaignView[]>(BASE, undefined, undefined, FRESH), () => demo),
  audience: (audience: { stayedWithinDays?: number }) => live(() => post<{ guests: number }>(`${BASE}/audience`, { audience }, NO_KEY), () => ({ guests: audience.stayedWithinDays ? 40 : 120 })),
  create: (input: CampaignInput) =>
    live(
      () => post<CampaignView>(BASE, input, NO_KEY),
      () => {
        const made: CampaignView = { id: `demo-${Date.now()}`, ...input, templateName: 'sample message', status: 'draft', statusReason: null, recipientCount: 0, sent: 0, failed: 0, skipped: 0, waiting: 0, startedAt: null, finishedAt: null, createdAt: new Date().toISOString(), can: can('draft') };
        demo = [made, ...demo];
        return made;
      },
    ),
  update: (id: string, input: CampaignInput) =>
    live(
      () => patch<CampaignView>(`${BASE}/${enc(id)}`, input, NO_KEY),
      () => {
        demo = demo.map((c) => (c.id === id ? { ...c, ...input } : c));
        return demo.find((c) => c.id === id) as CampaignView;
      },
    ),
  step: (id: string, action: 'start' | 'pause' | 'resume' | 'cancel') => live(() => post<CampaignView>(`${BASE}/${enc(id)}/${action}`, {}, NO_KEY), () => setDemo(id, action === 'start' || action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'cancelled')),
  remove: (id: string) =>
    live(
      () => del<{ removed: true }>(`${BASE}/${enc(id)}`, undefined, NO_KEY),
      () => {
        demo = demo.filter((c) => c.id !== id);
        return { removed: true as const };
      },
    ),
};
