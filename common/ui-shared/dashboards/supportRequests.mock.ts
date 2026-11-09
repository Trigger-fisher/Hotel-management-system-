// The in-memory mock of supportRequests.ts (dev and local-demo builds only): the hotel's Guest messages desk over a demo store, with the server's rules.
import type { DashResult, MockClock } from './common';
import { mockCall, mockError, ok } from './common';
import type { DeskSupportPage, DeskSupportRequest, SupportStatus } from './supportRequests';

interface Stored extends DeskSupportRequest {
  hotelId: string;
  hotelName: string;
}

const HOTEL = { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot' };
const ago = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

export function createSupportMock(clock: MockClock = {}) {
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const rows: Stored[] = [
    { id: 'sr-1', number: 'S-4C21AA', subject: 'Wrong charge on my bill', message: 'The laundry was charged twice on 4 October.\nPlease check.', billRef: 'HS-0412', orderRef: null, status: 'answered', reply: 'Sorry! We removed the second laundry charge.', repliedAt: ago(20), repliedByName: 'Riya Desk', createdAt: ago(26), guestName: 'Amit Joshi', ...HOTEL },
    { id: 'sr-2', number: 'S-91B0E3', subject: 'Can I check out at 2 pm?', message: 'My flight is at 6 pm. Could I keep the room until 2 pm?', billRef: null, orderRef: null, status: 'open', reply: null, repliedAt: null, repliedByName: null, createdAt: ago(2), guestName: 'Amit Joshi', ...HOTEL },
    { id: 'sr-3', number: 'S-07DD12', subject: 'Extra pillow', message: 'Room 102 needs two extra pillows, thank you.', billRef: null, orderRef: null, status: 'open', reply: null, repliedAt: null, repliedByName: null, createdAt: ago(1), guestName: 'Bina Shah', ...HOTEL },
  ];
  const deskView = (r: Stored): DeskSupportRequest => {
    const { hotelId: _h, hotelName: _n, ...rest } = r;
    void _h; void _n;
    return { ...rest };
  };

  return {
    desk: {
      list(q: { status?: SupportStatus | 'all'; search?: string; page?: number; pageSize?: number } = {}): Promise<DashResult<DeskSupportPage>> {
        return call(() => {
          const status = q.status ?? 'open';
          const s = (q.search ?? '').trim().toLowerCase();
          const found = rows
            .filter((r) => status === 'all' || r.status === status)
            .filter((r) => !s || `${r.number} ${r.guestName} ${r.subject} ${r.message}`.toLowerCase().includes(s))
            .sort((a, b) => (status === 'open' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
          const pageSize = q.pageSize ?? 25;
          const page = Math.max(1, q.page ?? 1);
          return ok({ items: found.slice((page - 1) * pageSize, page * pageSize).map(deskView), total: found.length, page, pageSize, openCount: rows.filter((r) => r.status === 'open').length });
        });
      },
      respond(id: string, input: { status: 'answered' | 'closed'; reply?: string | null }): Promise<DashResult<DeskSupportRequest>> {
        return call(() => {
          const r = rows.find((x) => x.id === id);
          if (!r) return mockError('NOT_FOUND');
          if (r.status === 'closed') return mockError('CONFLICT', undefined, { message: 'This message is closed.' });
          const reply = (input.reply ?? '').trim();
          if (input.status === 'answered' && reply.length < 2) return mockError('VALIDATION_FAILED', { reply: 'Write the answer the guest will read.' });
          Object.assign(r, { status: input.status, reply: reply || r.reply, repliedAt: new Date().toISOString(), repliedByName: 'You' });
          return ok(deskView(r));
        });
      },
    },
  };
}
