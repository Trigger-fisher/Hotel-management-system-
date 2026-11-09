// "Today" for the two portals: the mock's fixed date in mock mode (its data is built around it), the hotel's IST calendar date against the real server.
import { istToday } from '@shared/dashboards/cash';

import { apiMode } from '@/lib/api/mode';

export function portalToday(mockToday: string): string {
  return apiMode() === 'real' ? istToday() : mockToday;
}
