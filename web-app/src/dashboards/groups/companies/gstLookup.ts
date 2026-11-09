'use client';

// The GST number field's lookup (MJ, 2 Nov 2026; platform 0167): on leaving the field, the GSTIN is checked (state, check character) and its company found, from our saved records first and
// from the GST lookup service once. The real server answers /api/v1/gst/lookup; the mock only makes the free check (no company records in the demo).
import { useCallback, useState } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { checkGstin, gstCopy, type GstLookupResult, type GstRegistryEntry } from '@shared/dashboards/gst';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';

interface GstApi {
  /** `except`: the company being edited, so its own GSTIN is not reported as "already in your hotel". */
  lookup(gstin: string, except?: string): Promise<DashResult<GstLookupResult>>;
}

const gstApi: GstApi = chooseApi<GstApi>(
  // fresh: never the 20-second GET memory, so "Fetch details" really asks again
  () => ({ lookup: (gstin, except) => client.get<GstLookupResult>('/gst/lookup', { gstin, except }, undefined, { fresh: true }) }),
  () => ({
    lookup: async (gstin) => {
      const check = checkGstin(gstin);
      return { ok: true, data: { check, entry: null, from: 'none', providerReady: false, message: check.ok ? gstCopy.notReady : gstCopy.problems[check.problem ?? 'format'] } };
    },
  }),
);

/** The line under the GST number field, and the company found, for the form to fill its empty fields from. */
export function useGstLookup(except?: string): { result: GstLookupResult | null; busy: boolean; look: (gstin: string) => Promise<GstLookupResult | null>; clear: () => void } {
  const [result, setResult] = useState<GstLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const look = useCallback(async (gstin: string): Promise<GstLookupResult | null> => {
    if (gstin.trim() === '') {
      setResult(null);
      return null;
    }
    setBusy(true);
    try {
      const res = await gstApi.lookup(gstin, except);
      // a refused or failed request still says something under the field (never a silent nothing)
      const data: GstLookupResult = res.ok
        ? res.data
        : { check: checkGstin(gstin), entry: null, from: 'none', providerReady: true, message: res.error.code === 'RATE_LIMITED' ? 'Too many lookups in a minute. Wait a moment and press Fetch details again.' : gstCopy.failed };
      setResult(data);
      return data;
    } finally {
      setBusy(false);
    }
  }, [except]);
  return { result, busy, look, clear: () => setResult(null) };
}

/** The line shown under the field: the state read from the number, then what the lookup found. */
export function gstLine(r: GstLookupResult): string {
  const name = r.entry ? r.entry.tradeName ?? r.entry.legalName : null;
  return [r.check.ok && r.check.state ? r.check.state : null, name, r.message].filter(Boolean).join(' · ');
}

/** The company's address in one line for the form (at most 100 characters): the record's address, then its city and state when the address does not already name them. */
export function gstAddress(e: GstRegistryEntry): string {
  const has = (part: string | null) => !!part && (e.address ?? '').toUpperCase().includes(part.toUpperCase());
  return [e.address, has(e.city) ? null : e.city, has(e.district) ? null : e.district, has(e.state) ? null : e.state].filter(Boolean).join(', ').slice(0, 100);
}
