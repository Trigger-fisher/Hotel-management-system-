'use client';

import { useAsync } from '@/components/ui';
import { foApi } from './api';

/** Payment modes from the server (getOptions), as dropdown options; empty until loaded. */
export function usePaymentModes(): { value: string; label: string }[] {
  const options = useAsync(() => foApi.getOptions(), []);
  return (options.state.status === 'ready' ? options.state.data.paymentModes : []).map((m) => ({ value: m, label: m }));
}
