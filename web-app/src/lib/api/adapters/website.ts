// The hotel website's back office over the real server: /api/v1/website/* (docs/BACKEND.md 7.7). Enquiries, rooms, rates, the availability calendar,
// the gallery, page wording, services, house rules, nearby places, site settings and the overview exist: every call has a route.
import type { ListQuery, Page } from '@shared/dashboards/common';
import type {
  EnquiryDecision, WebBlockInput, WebBulkRatesInput, WebCalendarChanges, WebCalendarWeek, WebContent, WebEnquiry, WebEnquiryInput, WebEnquiryStats, WebNearbyInput,
  WebNearbyList, WebNearbyPlace, WebOverview, WebPhoto, WebPolicyCard, WebPolicyInput, WebRatePlan, WebRatePlanInput, WebRoom, WebRoomInput, WebRoomRates, WebService, WebServiceInput,
  WebSettings, WebSettingsInput, WebSite, WebSiteInput, WebsiteApi,
} from '@shared/dashboards/website';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

export type { WebsiteApi };

const enc = encodeURIComponent;

export function createWebsiteRealApi(): WebsiteApi {
  const rooms = () => api.get<WebRoom[]>('/website/rooms');

  return {
    // fy = the financial year start (e.g. 2026 = FY 2026-27); omitted = the current one. A bad year is a 422.
    getOverview: (fy?: number) => api.get<WebOverview>('/website/overview', { fy }),

    // ---------------- enquiries
    listEnquiries: (q: ListQuery = {}) =>
      api.get<{ page: Page<WebEnquiry>; stats: WebEnquiryStats }>('/website/enquiries', { search: q.search, tab: q.tab, page: q.page, pageSize: snapPageSize(q.pageSize) }),
    getEnquiry: (id) => api.get<WebEnquiry>(`/website/enquiries/${enc(id)}`),
    updateEnquiry: (id, input: WebEnquiryInput) => api.patch<WebEnquiry>(`/website/enquiries/${enc(id)}`, input),
    confirmEnquiry: (id) => api.post<EnquiryDecision>(`/website/enquiries/${enc(id)}/confirm`, {}),
    declineEnquiry: (id, reason) => api.post<EnquiryDecision>(`/website/enquiries/${enc(id)}/decline`, { reason }),
    deleteEnquiry: (id) => api.del<{ id: string }>(`/website/enquiries/${enc(id)}`),

    // ---------------- rooms
    listRooms: rooms,
    getRoom: (id) => api.get<WebRoom>(`/website/rooms/${enc(id)}`),
    createRoom: (input: WebRoomInput) => api.post<WebRoom>('/website/rooms', input),
    updateRoom: (id, input: WebRoomInput) => api.patch<WebRoom>(`/website/rooms/${enc(id)}`, input),
    deleteRoom: (id) => api.del<{ id: string }>(`/website/rooms/${enc(id)}`),
    /** The server answers `{id}`; the screen wants the rooms in their new order. */
    moveRoom: async (id, { direction }) => {
      const moved = await api.post<{ id: string }>(`/website/rooms/${enc(id)}/move`, { direction });
      return moved.ok ? rooms() : moved;
    },

    // ---------------- rates
    listRates: () => api.get<WebRoomRates[]>('/website/rates'),
    createPlan: (roomId, input: WebRatePlanInput) => api.post<WebRatePlan>(`/website/rooms/${enc(roomId)}/plans`, input),
    updatePlan: (id, input: WebRatePlanInput) => api.patch<WebRatePlan>(`/website/plans/${enc(id)}`, input),
    togglePlan: (id) => api.post<WebRatePlan>(`/website/plans/${enc(id)}/toggle`, {}),
    deletePlan: (id) => api.del<{ id: string }>(`/website/plans/${enc(id)}`),
    movePlan: (id, { direction }) => api.post<{ id: string }>(`/website/plans/${enc(id)}/move`, { direction }),

    // ---------------- calendar
    getCalendar: (start) => api.get<WebCalendarWeek>('/website/calendar', { start }),
    saveCalendar: (changes: WebCalendarChanges) => api.put<{ saved: number; error: string | null }>('/website/calendar', changes),
    toggleBlock: (roomId, date) => api.post<{ blocked: boolean }>('/website/calendar/block-date', { roomId, date }),
    blockRange: (input: WebBlockInput) => api.post<{ blocked: number; skipped: number; message: string }>('/website/calendar/blocks', input),
    unblockRanges: (ranges) => api.post<{ unblocked: number; message: string }>('/website/calendar/unblock', { ranges }),
    listPlanNames: () => api.get<string[]>('/website/calendar/plan-names'),
    /** The server lists the rooms it skipped; the screen counts them. */
    bulkRates: (input: WebBulkRatesInput) =>
      api.dashMap<{ dates: number; rooms: number; skipped: string[]; message: string }, { dates: number; rooms: number; skipped: number; message: string }>(
        'POST', '/website/calendar/bulk-rates', { body: input }, (r) => ({ ...r, skipped: r.skipped.length }),
      ),

    // ---------------- gallery (BACKEND.md 7.7: photos, files travel as base64 inside the JSON, 1 to 10 files, all or nothing)
    listPhotos: () => api.get<WebPhoto[]>('/website/photos'),
    updatePhoto: (id, input) => api.patch<WebPhoto>(`/website/photos/${enc(id)}`, { caption: input.caption, altText: input.altText }),
    deletePhoto: (id) => api.del<{ id: string }>(`/website/photos/${enc(id)}`),
    addPhotos: (input) => api.post<WebPhoto[]>('/website/photos', { caption: input.caption, files: input.files }),
    /** The server answers the whole list in its new order; 409 at an end. */
    movePhoto: (id, direction) => api.post<WebPhoto[]>(`/website/photos/${enc(id)}/move`, { direction }),

    // ---------------- page wording (the whole object)
    getContent: () => api.get<WebContent>('/website/content'),
    updateContent: (input: WebContent) => api.put<WebContent>('/website/content', input),

    // ---------------- services, house rules, nearby places
    listServices: () => api.get<WebService[]>('/website/services'),
    saveService: (id, input: WebServiceInput) => saveCard<WebService>('services', id, serviceBody(input)),
    listPolicies: () => api.get<WebPolicyCard[]>('/website/policies'),
    savePolicy: (id, input: WebPolicyInput) => saveCard<WebPolicyCard>('policies', id, policyBody(input)),
    listNearby: () => api.get<WebNearbyList>('/website/nearby'),
    saveNearby: (id, input: WebNearbyInput) => saveCard<WebNearbyPlace>('nearby', id, { title: input.title, distanceLabel: input.distanceLabel, mapUrl: input.mapUrl, mapQuery: input.mapQuery }),
    deleteListItem: (kind, id) => api.del<{ id: string }>(`/website/${kind}/${enc(id)}`),
    moveListItem: (kind, id, direction) => api.post<{ id: string }>(`/website/${kind}/${enc(id)}/move`, { direction }),

    // ---------------- the website's live switch and addresses (decision 55; the list is replaced on save, every problem is a 422 on domains)
    getSite: () => api.get<WebSite>('/website/site'),
    saveSite: (input: WebSiteInput) => api.put<WebSite>('/website/site', { live: input.live, domains: input.domains }),

    // ---------------- settings (PUT: the whole form; secrets are only 'Set' flags and come back empty for a person without the ability)
    getSettings: () => api.get<WebSettings>('/website/settings'),
    updateSettings: (input: WebSettingsInput) => api.put<WebSettings>('/website/settings', input),
    // Google connect and refresh answer an honest 409 sentence until the Google port exists; the screen shows it.
    googleConnect: () => api.post<WebSettings>('/website/google/connect', {}),
    googleRefresh: () => api.post<WebSettings>('/website/google/refresh', {}),
    googleDisconnect: () => api.post<WebSettings>('/website/google/disconnect', {}),
  };
}

/** A card is created with POST /website/<kind> and changed with PATCH /website/<kind>/{id}. */
function saveCard<T>(kind: 'services' | 'policies' | 'nearby', id: string | null, body: unknown) {
  return id === null ? api.post<T>(`/website/${kind}`, body) : api.patch<T>(`/website/${kind}/${enc(id)}`, body);
}

/** The strict routes take only these keys (icon is {fileName, dataBase64}; removeIcon only when ticked). */
const serviceBody = (i: WebServiceInput) => ({ title: i.title, description: i.description, ...(i.icon ? { icon: i.icon } : {}), ...(i.removeIcon ? { removeIcon: true } : {}) });
const policyBody = (i: WebPolicyInput) => ({ title: i.title, lines: i.lines, ...(i.icon ? { icon: i.icon } : {}), ...(i.removeIcon ? { removeIcon: true } : {}) });
