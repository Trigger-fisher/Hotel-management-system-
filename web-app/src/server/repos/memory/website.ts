import "server-only";
import { randomUUID } from "node:crypto";
import type { EnquiryRecord, RoomTypeRecord } from "../frontOffice";
import type {
  DateRateRecord,
  GalleryPhotoRecord,
  InventoryRecord,
  NearbyRecord,
  OrderedRepo,
  PageContentFields,
  PolicyRecord,
  ServiceRecord,
  SiteEnquiryRecord,
  SitePlanRecord,
  SiteRoomRecord,
  SiteSecrets,
  SiteSettingsFields,
  WebsiteRepos,
} from "../website";
import { RepoError, type ListResult } from "../types";
import type { BillingData } from "./billing";

// The in-memory double of the website repositories, in the SAME per-hotel data as the front office: `roomTypes` and `enquiries` are the arrays the
// front office reads read-only, so a room or an enquiry seeded there reads here with the defaults of a row nobody has edited yet (normalised in
// place, on first touch). Plans live inside their room (as the front office's RoomTypeRecord has them) with the extra fields the website keeps.

export interface WebsiteData {
  datedRates: DateRateRecord[];
  roomInventory: InventoryRecord[];
  referenceCounters: Map<number, number>;
  gallery: GalleryPhotoRecord[];
  siteServices: ServiceRecord[];
  policyCards: PolicyRecord[];
  nearbyPlaces: NearbyRecord[];
  pageContent: PageContentFields | null;
  siteSettings: { fields: SiteSettingsFields; secrets: SiteSecrets } | null;
}

export const emptyWebsiteData = (): WebsiteData => ({ datedRates: [], roomInventory: [], referenceCounters: new Map(), gallery: [], siteServices: [], policyCards: [], nearbyPlaces: [], pageContent: null, siteSettings: null });

const copy = <T>(r: T): T => structuredClone(r);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });
const slugify = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "room";

const DEFAULT_CONTENT: PageContentFields = {
  heroTitleLine1: "Where every stay",
  heroTitleEmphasis: "feels like coming home",
  heroLead: null,
  quickCheckTitle: "Check availability",
  qcMsgPickDates: "Please pick both check-in and check-out dates first.",
  qcMsgAvailable: "Good news - we have rooms for your dates!",
  qcMsgUnavailable: "Those exact rooms look full, but call us - dates shift often and we may still fit you in.",
  qcMsgError: "Could not check right now - please call us instead.",
  aboutKicker: "Our Story",
  aboutHeading: "A family hotel that never stopped caring",
  aboutP1: null,
  aboutP2: null,
  aboutP3: null,
  enquireHeading: "Send us your dates. We will do the rest.",
  enquireLead: null,
  enquirePoints: [],
  bookingTermsText: null,
  fmMsgName: "Please enter your name.",
  fmMsgPhone: "Please enter a valid 10-digit mobile number.",
  fmMsgEmail: "That email address does not look right. Leave it blank if you prefer.",
  fmMsgCheckin: "Please pick a check-in date.",
  fmMsgCheckout: "Please pick a check-out date.",
  fmMsgRoom: 'Please pick a room, or enter "not sure yet".',
  fmMsgAdults: "Please enter the number of adults.",
  fmMsgChildren: "Please enter the number of children (0 if none).",
  fmMsgMessage: 'Please tell us anything we should know (or write "none").',
  fmMsgTerms: "Please accept the Terms & Conditions to continue.",
  fmMsgSuccess: "Thank you! Your enquiry reference is {{reference}}. We will call you shortly to confirm.",
  policiesFooterNote: null,
  footerTagline: null,
};

const DEFAULT_SETTINGS: SiteSettingsFields = {
  openedYear: null, gmPhone: null, receptionPhone: null, email: null, address: "", checkinTime: "12:00 PM", checkoutTime: "11:00 AM",
  metaTitle: null, metaDescription: null, metaKeywords: null, logoPath: null, faviconPath: null, gbpLink: null, facebookLink: null, instagramLink: null, mapLat: null, mapLng: null,
  googlePlaceId: null, googleMinReviewRating: 3, recipients: [], smtpHost: null, smtpPort: null, smtpFromEmail: null, smtpFromName: null, gbpAccountId: null, gbpLocationId: null,
  googleLastFetchedAt: null, googleReviewCount: 0,
};
const NO_SECRETS: SiteSecrets = { googleMapsApiKey: null, gbpOauthClientId: null, gbpOauthClientSecret: null, gbpRefreshToken: null, gbpAccessToken: null, smtpUsername: null, smtpPassword: null };

export function bindWebsite(data: BillingData & WebsiteData & { roomTypes: RoomTypeRecord[]; enquiries: EnquiryRecord[] }): WebsiteRepos {
  // ---- rooms and plans live in the front office's array; give a row seeded there the website's defaults
  type FullRoom = Omit<SiteRoomRecord, "plans"> & { plans: SitePlanRecord[] };
  const room = (r: RoomTypeRecord): FullRoom => {
    const x = r as unknown as Record<string, unknown>;
    x.slug ??= slugify(r.name);
    x.size ??= null;
    x.bedType ??= null;
    x.maxGuests ??= 2;
    x.note ??= null;
    x.badgeLabel ??= null;
    x.showPrice ??= false;
    x.available ??= true;
    x.photos ??= [];
    r.plans.forEach((p, i) => {
      const q = p as unknown as Record<string, unknown>;
      q.id ??= `${r.id}:plan:${i}`;
      q.roomId ??= r.id;
      q.extraPersonPaise ??= null;
      q.tiers ??= [...(p.singlePaise !== null ? [{ guests: 1, pricePaise: p.singlePaise }] : []), { guests: 2, pricePaise: p.doublePaise }];
    });
    return r as unknown as FullRoom;
  };
  const rooms = () => data.roomTypes.map(room);
  const roomOf = (id: string) => rooms().find((r) => r.id === id);
  const plansOf = (roomIds?: readonly string[]) => rooms().filter((r) => !roomIds || roomIds.includes(r.id)).flatMap((r) => r.plans);
  const planOf = (id: string) => plansOf().find((p) => p.id === id);
  const enquiry = (e: EnquiryRecord): SiteEnquiryRecord => {
    const x = e as unknown as Record<string, unknown>;
    x.status ??= "new";
    x.decisionNote ??= null;
    x.decidedBy ??= null;
    x.decidedByName ??= null;
    x.decidedAt ??= null;
    x.ipAddress ??= null;
    x.createdAt ??= new Date();
    x.updatedAt ??= x.createdAt;
    return e as SiteEnquiryRecord;
  };
  const enquiries = () => data.enquiries.map(enquiry);
  const roomName = (id: string | null): string | null => (id ? (data.roomTypes.find((r) => r.id === id)?.name ?? null) : null);
  const withRoom = (e: SiteEnquiryRecord) => ({ ...copy(e), roomName: roomName(e.roomId) });

  const ordered = <T extends { id: string; sortOrder: number }, F>(rows: () => T[], set: (next: T[]) => void, make: (f: F, id: string, sortOrder: number) => T): OrderedRepo<T, F> => ({
    list: async () => [...rows()].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1)).map(copy),
    get: async (id) => copy(rows().find((r) => r.id === id) ?? null),
    count: async () => rows().length,
    create: async (fields) => {
      const row = make(fields, randomUUID(), rows().reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1);
      set([...rows(), row]);
      return copy(row);
    },
    update: async (id, patch) => {
      const r = rows().find((x) => x.id === id);
      if (!r) throw new RepoError("check", "row not found");
      Object.assign(r, copy(patch));
      return copy(r);
    },
    remove: async (id) => {
      const before = rows().length;
      set(rows().filter((r) => r.id !== id));
      return rows().length < before;
    },
    setOrder: async (ids) => {
      const list = rows();
      if (ids.length === 0 || !ids.every((i) => list.some((r) => r.id === i))) return false;
      ids.forEach((i, position) => {
        list.find((r) => r.id === i)!.sortOrder = position;
      });
      return true;
    },
  });

  return {
    siteEnquiries: {
      get: async (id) => {
        const e = data.enquiries.find((x) => x.id === id);
        return e ? copy(enquiry(e)) : null;
      },
      getMany: async (ids) => enquiries().filter((e) => ids.includes(e.id)).map(copy),
      list: async (q) => {
        const rows = enquiries()
          .filter((e) => (q.tab === "all" ? true : q.tab === "pending" ? e.status === "new" || e.status === "pending" : e.status === q.tab))
          .filter((e) => !q.words || q.words.every((w) => lower([e.name, e.phone, e.email, e.reference].join(" ")).includes(w)));
        const decided = q.tab === "confirmed" || q.tab === "declined";
        rows.sort((a, b) => {
          const ta = decided ? (a.decidedAt ?? a.createdAt).getTime() : a.createdAt.getTime();
          const tb = decided ? (b.decidedAt ?? b.createdAt).getTime() : b.createdAt.getTime();
          return tb - ta || (a.id < b.id ? 1 : -1);
        });
        return paged(rows, q);
      },
      promoteNew: async (before) => {
        let n = 0;
        for (const e of enquiries()) {
          if (e.status !== "new" || e.createdAt >= before) continue;
          e.status = "pending";
          n += 1;
        }
        return n;
      },
      counts: async (range) => {
        const rows = enquiries().filter((e) => !range || (e.createdAt >= range.from && e.createdAt <= range.to));
        return {
          all: rows.length,
          pending: rows.filter((e) => e.status === "new" || e.status === "pending").length,
          confirmed: rows.filter((e) => e.status === "confirmed").length,
          declined: rows.filter((e) => e.status === "declined").length,
        };
      },
      confirmedStays: async (roomId, from, to, ignoreId) =>
        enquiries()
          .filter((e) => e.roomId === roomId && e.status === "confirmed" && e.id !== ignoreId && e.checkIn !== null && e.checkOut !== null && e.checkIn <= to && e.checkOut > from)
          .map((e) => ({ checkIn: e.checkIn!, checkOut: e.checkOut! })),
      arrivals: async (from, to) =>
        enquiries()
          .filter((e) => e.status === "confirmed" && e.checkIn !== null && e.checkIn >= from && e.checkIn <= to)
          .sort((a, b) => (a.checkIn! < b.checkIn! ? -1 : a.checkIn! > b.checkIn! ? 1 : a.name.localeCompare(b.name)))
          .map(withRoom),
      recent: async (range, limit) =>
        enquiries()
          .filter((e) => e.createdAt >= range.from && e.createdAt <= range.to)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)
          .map(withRoom),
      hasForRoom: async (roomId) => enquiries().some((e) => e.roomId === roomId),
      create: async (row) => {
        if (enquiries().some((e) => e.reference === row.reference)) throw new RepoError("unique", "site_enquiries_reference_key");
        if (row.checkIn && row.checkOut && row.checkOut < row.checkIn) throw new RepoError("check", "site_enquiries_dates_ck");
        const { ipAddress, createdAt, reference, ...fields } = row;
        const rec = { ...fields, id: randomUUID(), reference, status: "new", decisionNote: null, decidedBy: null, decidedByName: null, decidedAt: null, ipAddress, createdAt, updatedAt: createdAt } as SiteEnquiryRecord;
        data.enquiries.push(rec);
        return copy(rec);
      },
      update: async (id, patch) => {
        const e = data.enquiries.find((x) => x.id === id);
        if (!e) throw new RepoError("check", "enquiry not found");
        Object.assign(enquiry(e), copy(patch), { updatedAt: new Date() });
        return copy(e as SiteEnquiryRecord);
      },
      decide: async (id, d) => {
        const e = data.enquiries.find((x) => x.id === id);
        if (!e) throw new RepoError("check", "enquiry not found");
        Object.assign(enquiry(e), { status: d.status, decidedBy: d.by, decidedByName: d.byName, decidedAt: d.at, decisionNote: d.note, updatedAt: d.at });
        return copy(e as SiteEnquiryRecord);
      },
      remove: async (id) => {
        const before = data.enquiries.length;
        data.enquiries = data.enquiries.filter((e) => e.id !== id);
        return data.enquiries.length < before;
      },
    },

    references: {
      next: async (fiscalYear) => {
        const n = (data.referenceCounters.get(fiscalYear) ?? 0) + 1;
        data.referenceCounters.set(fiscalYear, n);
        return n;
      },
    },

    siteRooms: {
      list: async () =>
        rooms()
          .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
          .map((r) => ({ ...copy({ ...r, plans: [] }), plansCount: r.plans.length })),
      get: async (id) => {
        const r = roomOf(id);
        return r ? copy({ ...r, plans: [] }) : null;
      },
      getMany: async (ids) => rooms().filter((r) => ids.includes(r.id)).map((r) => copy({ ...r, plans: [] })),
      slugTaken: async (slug, except) => rooms().some((r) => r.slug === slug && r.id !== except),
      create: async (fields, by) => {
        void by;
        if (rooms().some((r) => r.slug === fields.slug)) throw new RepoError("unique", "site_rooms_slug_key");
        const r = { ...copy(fields), id: randomUUID(), sortOrder: rooms().reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1, plans: [] as SitePlanRecord[] };
        data.roomTypes.push(r as unknown as RoomTypeRecord);
        return copy({ ...room(r as unknown as RoomTypeRecord), plans: [] });
      },
      update: async (id, patch) => {
        const r = roomOf(id);
        if (!r) throw new RepoError("check", "room not found");
        Object.assign(r, copy(patch));
        return copy({ ...r, plans: [] });
      },
      remove: async (id) => {
        const before = data.roomTypes.length;
        data.roomTypes = data.roomTypes.filter((r) => r.id !== id);
        // ON DELETE CASCADE: the room's dated prices and calendar rows go with it; an enquiry's room is set null
        const planIds = new Set(plansOf([id]).map((p) => p.id));
        data.datedRates = data.datedRates.filter((d) => !planIds.has(d.planId));
        data.roomInventory = data.roomInventory.filter((i) => i.roomId !== id);
        for (const e of data.enquiries) if (e.roomId === id) e.roomId = null;
        return data.roomTypes.length < before;
      },
      setOrder: async (ids) => {
        const list = rooms();
        if (ids.length === 0 || !ids.every((i) => list.some((r) => r.id === i))) return false;
        ids.forEach((i, position) => {
          list.find((r) => r.id === i)!.sortOrder = position;
        });
        return true;
      },
    },

    sitePlans: {
      forRooms: async (roomIds, options) =>
        plansOf(roomIds)
          .filter((p) => !options?.activeOnly || p.active)
          .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
          .map(copy),
      get: async (id) => copy(planOf(id) ?? null),
      names: async () => [...new Set(plansOf().map((p) => p.name))].sort(),
      create: async (roomId, fields) => {
        const r = roomOf(roomId);
        if (!r) throw new RepoError("check", "room not found");
        const p: SitePlanRecord = { ...copy(fields), id: randomUUID(), roomId, sortOrder: r.plans.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1, active: true };
        r.plans.push(p);
        return copy(p);
      },
      update: async (id, patch) => {
        const p = planOf(id);
        if (!p) throw new RepoError("check", "plan not found");
        Object.assign(p, copy(patch));
        return copy(p);
      },
      remove: async (id) => {
        const r = rooms().find((x) => x.plans.some((p) => p.id === id));
        if (!r) return false;
        r.plans = r.plans.filter((p) => p.id !== id);
        data.datedRates = data.datedRates.filter((d) => d.planId !== id);
        return true;
      },
      setOrder: async (ids) => {
        const found = ids.map(planOf);
        if (ids.length === 0 || found.some((p) => !p) || new Set(found.map((p) => p!.roomId)).size !== 1) return false;
        ids.forEach((i, position) => {
          planOf(i)!.sortOrder = position;
        });
        return true;
      },
    },

    calendar: {
      rates: async (planIds, from, to) => data.datedRates.filter((d) => planIds.includes(d.planId) && d.date >= from && d.date <= to).map(copy),
      inventory: async (roomIds, from, to) => data.roomInventory.filter((i) => roomIds.includes(i.roomId) && i.date >= from && i.date <= to).map(copy),
      upsertRates: async (rows) => {
        for (const r of rows) {
          const existing = data.datedRates.find((d) => d.planId === r.planId && d.date === r.date);
          if (existing) {
            if (r.doublePaise !== undefined) existing.doublePaise = r.doublePaise;
            if (r.singlePaise !== undefined) existing.singlePaise = r.singlePaise;
          } else data.datedRates.push({ planId: r.planId, date: r.date, doublePaise: r.doublePaise ?? r.planDouble, singlePaise: r.singlePaise !== undefined ? r.singlePaise : r.planSingle });
        }
      },
      upsertInventory: async (rows) => {
        for (const r of rows) {
          const existing = data.roomInventory.find((i) => i.roomId === r.roomId && i.date === r.date);
          if (existing) Object.assign(existing, { roomsLeft: r.roomsLeft, blocked: r.blocked });
          else data.roomInventory.push({ roomId: r.roomId, date: r.date, roomsLeft: r.roomsLeft, blocked: r.blocked });
        }
      },
      setBlocked: async (rows) => {
        for (const r of rows) {
          const existing = data.roomInventory.find((i) => i.roomId === r.roomId && i.date === r.date);
          if (existing) existing.blocked = r.blocked;
          else data.roomInventory.push({ roomId: r.roomId, date: r.date, roomsLeft: r.totalCount, blocked: r.blocked });
        }
      },
      blockedFrom: async (from) =>
        data.roomInventory
          .filter((i) => i.blocked && i.date >= from)
          .map((i) => ({ roomId: i.roomId, roomName: roomName(i.roomId) ?? "", date: i.date }))
          .sort((a, b) => (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : a.date < b.date ? -1 : 1)),
    },

    content: {
      get: async () => copy((data.pageContent ??= copy(DEFAULT_CONTENT))),
      update: async (patch) => {
        data.pageContent = { ...(data.pageContent ?? copy(DEFAULT_CONTENT)), ...copy(patch) };
        return copy(data.pageContent);
      },
    },
    gallery: ordered<GalleryPhotoRecord, { path: string; caption: string | null; altText: string | null }>(() => data.gallery, (n) => (data.gallery = n), (f, id, sortOrder) => ({ id, sortOrder, ...f })),
    services: ordered<ServiceRecord, { title: string; description: string | null; iconPath?: string | null }>(() => data.siteServices, (n) => (data.siteServices = n), (f, id, sortOrder) => ({ id, sortOrder, title: f.title, description: f.description, iconPath: f.iconPath ?? null })),
    policies: ordered<PolicyRecord, { title: string; lines: string[]; iconPath?: string | null }>(() => data.policyCards, (n) => (data.policyCards = n), (f, id, sortOrder) => ({ id, sortOrder, title: f.title, lines: f.lines, iconPath: f.iconPath ?? null })),
    nearby: ordered<NearbyRecord, { title: string; distanceLabel: string; mapQuery: string | null; mapUrl: string | null; originLat: number | null; originLng: number | null }>(() => data.nearbyPlaces, (n) => (data.nearbyPlaces = n), (f, id, sortOrder) => ({ id, sortOrder, ...f })),

    siteSettings: {
      get: async () => copy((data.siteSettings ??= { fields: copy(DEFAULT_SETTINGS), secrets: copy(NO_SECRETS) })),
      update: async (patch) => {
        const cur = (data.siteSettings ??= { fields: copy(DEFAULT_SETTINGS), secrets: copy(NO_SECRETS) });
        const { secrets, ...fields } = patch;
        Object.assign(cur.fields, copy(fields));
        if (secrets) Object.assign(cur.secrets, copy(secrets));
        return copy(cur);
      },
    },

    websiteChanges: {
      recent: async (limit) =>
        data.systemLogs
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => l.module === "website")
          .reverse()
          .slice(0, limit)
          .map(({ l, i }) => ({ id: String(i), summary: l.summary, userName: l.userName, at: (l as { at?: Date }).at ?? new Date(0) })),
    },
  };
}

