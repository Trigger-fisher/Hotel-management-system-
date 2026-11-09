import "server-only";
import type { WebListKind, WebNearbyList, WebNearbyPlace, WebPolicyCard, WebService } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { checkUpload, ICON_TYPES, MAX_ICON_BYTES, randomName, type UploadInput } from "../../media/store";
import type { NearbyRecord, OrderedRepo, PolicyRecord, ServiceRecord } from "../../repos/website";
import { diffDetails } from "../cash/syslog";
import { actorOf, conflict, fieldError, logLine, notFound, type WebsiteDeps, type WebsiteUnitRepos, type Who } from "./context";
import { matchWords } from "../../validation/listQuery";
import { mediaUrl } from "./galleryService";
import { coordinatesFromUrl, isShortMapLink, kmLabel, policyLines, straightLineKm } from "./mapTools";

// The cards of the website: services and facilities (a title, a short line, an icon), the house rules (a title, lines, an icon) and the nearby places
// (a name, a distance, a map link). Pallav Website/ServiceController, PolicyController, NearbyPlaceController. Part `website.content`. An icon goes to the
// media store (the real type is checked); "remove icon" and a new file follow Pallav (a new file wins). Spec: docs/BACKEND.md section 14b.

const PART = "website.content";
const NO_TITLE = "Enter a title.";
const BAD_LINK = "Enter a full link starting with https://";
const NEED_DISTANCE = "Distance is required - type it in, or paste a Google Maps link for the place itself and set the hotel's own location in Website Settings so it can be worked out.";
const URL_OK = (u: string): boolean => /^https?:\/\/\S+\.\S+/i.test(u) && /^https?:\/\//i.test(u);
const cut = (s: string, max: number): string => Array.from((s ?? "").trim()).slice(0, max).join("");

interface ServiceDto extends WebService {
  icon: string | null;
  iconUrl: string | null;
}
interface PolicyDto extends WebPolicyCard {
  icon: string | null;
  iconUrl: string | null;
}

const iconOf = (path: string | null): { icon: string | null; iconUrl: string | null; hasIcon: boolean } => ({ icon: path, iconUrl: path ? mediaUrl(path) : null, hasIcon: path !== null });

const serviceDto = (r: ServiceRecord): ServiceDto => ({ id: r.id, title: r.title, description: r.description ?? "", ...iconOf(r.iconPath) });
const policyDto = (r: PolicyRecord): PolicyDto => ({ id: r.id, title: r.title, lines: [...r.lines], ...iconOf(r.iconPath) });
function nearbyDto(r: NearbyRecord): WebNearbyPlace {
  return { id: r.id, title: r.title, distanceLabel: r.distanceLabel, mapUrl: r.mapUrl ?? "", mapQuery: r.mapQuery ?? "", location: r.mapUrl ? (r.originLat !== null ? "exact" : "link") : "name" };
}

type Repos = WebsiteUnitRepos;
const repoOf = (repos: Repos, kind: WebListKind): OrderedRepo<{ id: string }, never> => (kind === "services" ? repos.services : kind === "policies" ? repos.policies : repos.nearby) as never;
const ENTITY: Record<WebListKind, string> = { services: "Service", policies: "House rule card", nearby: "Nearby place" };

export function createListService(deps: WebsiteDeps) {
  const { unit, catalog, media } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  /** The icon after a save: a new file replaces the old one, else "remove" clears it, else it stays (a new file wins over remove). Returns the new path and the files to delete after the unit commits. */
  async function iconAfter(session: VerifiedSession, current: string | null, icon: UploadInput | undefined, remove: boolean | undefined): Promise<{ path: string | null; delete: string[]; created: string[] }> {
    if (icon) {
      const c = checkUpload(icon, ICON_TYPES, MAX_ICON_BYTES, "icon");
      const small = await compressImage(c.bytes, "icon", c.type, "icon");
      const name = await media.put(session.hotelId, randomName(small.type), small.bytes);
      return { path: name, delete: current ? [current] : [], created: [name] };
    }
    if (remove && current) return { path: null, delete: [current], created: [] };
    return { path: current, delete: [], created: [] };
  }
  const drop = async (session: VerifiedSession, names: readonly string[]): Promise<void> => {
    for (const n of names) await media.remove(session.hotelId, n).catch(() => undefined);
  };

  /** The hotel's own pin, to measure from. */
  async function hotelPin(repos: Repos): Promise<{ lat: number; lng: number } | null> {
    const { fields } = await repos.siteSettings.get();
    return fields.mapLat !== null && fields.mapLng !== null ? { lat: fields.mapLat, lng: fields.mapLng } : null;
  }

  /** validated (NearbyPlaceController :85-122) */
  async function nearbyFields(repos: Repos, input: { title: string; distanceLabel: string; mapUrl: string; mapQuery: string }) {
    const title = cut(input.title, 80);
    const query = cut(input.mapQuery, 255) || null;
    const url = cut(input.mapUrl, 500) || null;
    let distance = cut(input.distanceLabel, 40);
    const fields: Record<string, string> = {};
    if (title === "") fields.title = NO_TITLE;
    if (url !== null && !URL_OK(url)) fields.mapUrl = BAD_LINK;
    if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
    // worked out once here and kept, so the website makes no request to Google on every visit (a short share link has to be followed over the network: not here)
    const at = url !== null && !isShortMapLink(url) ? coordinatesFromUrl(url) : null;
    if (distance === "" && at) {
      const hotel = await hotelPin(repos);
      if (hotel) distance = `~${kmLabel(straightLineKm(hotel.lat, hotel.lng, at.lat, at.lng))}`;
    }
    if (distance === "") throw fieldError("distanceLabel", NEED_DISTANCE);
    return { title, distanceLabel: distance, mapQuery: query, mapUrl: url, originLat: at?.lat ?? null, originLng: at?.lng ?? null };
  }

  return {
    async services(session: VerifiedSession, search?: string): Promise<ServiceDto[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => matchWords((await repos.services.list()).map(serviceDto), search, (s) => [s.title, s.description]));
    },
    async policies(session: VerifiedSession, search?: string): Promise<PolicyDto[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => matchWords((await repos.policies.list()).map(policyDto), search, (p) => [p.title, ...p.lines]));
    },
    async nearby(session: VerifiedSession, search?: string): Promise<WebNearbyList> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => ({ hotelPinned: (await hotelPin(repos)) !== null, places: matchWords((await repos.nearby.list()).map(nearbyDto), search, (p) => [p.title, p.distanceLabel]) }));
    },

    /** ServiceController store / update: title up to 80, line up to 255, an icon. */
    async saveService(session: VerifiedSession, id: string | null, input: { title: string; description: string; icon?: UploadInput; removeIcon?: boolean }, meta: RequestMeta): Promise<ServiceDto> {
      requirePermission(session, catalog, PART, id ? "edit" : "create");
      const title = cut(input.title, 80);
      if (title === "") throw fieldError("title", NO_TITLE);
      const description = cut(input.description, 255) || null;
      const w = await who(session, meta);
      let created: string[] = [];
      let gone: string[] = [];
      try {
        const saved = await unit.run(session, async (repos) => {
          const before = id ? await repos.services.get(id) : null;
          if (id && !before) throw notFound();
          const icon = await iconAfter(session, before?.iconPath ?? null, input.icon, input.removeIcon);
          created = icon.created;
          gone = icon.delete;
          const row = before ? await repos.services.update(before.id, { title, description, iconPath: icon.path }, session.userId) : await repos.services.create({ title, description, iconPath: icon.path }, session.userId);
          await repos.systemLogs.write(
            logLine(w, before
              ? { action: "updated", entity: ENTITY.services, summary: `Changed Service: ${row.title}`, subject: { id: row.id, label: row.title }, details: diffDetails({ title: before.title, description: before.description ?? "" }, { title: row.title, description: row.description ?? "" }) }
              : { action: "created", entity: ENTITY.services, summary: `Added Service: ${row.title}`, subject: { id: row.id, label: row.title } }),
          );
          return row;
        });
        await drop(session, gone);
        return serviceDto(saved);
      } catch (error) {
        await drop(session, created);
        throw error;
      }
    },

    /** PolicyController store / update: title up to 60, one rule per line (255 each, at most fifty). */
    async savePolicy(session: VerifiedSession, id: string | null, input: { title: string; lines: string[]; icon?: UploadInput; removeIcon?: boolean }, meta: RequestMeta): Promise<PolicyDto> {
      requirePermission(session, catalog, PART, id ? "edit" : "create");
      const title = cut(input.title, 60);
      if (title === "") throw fieldError("title", NO_TITLE);
      const lines = policyLines(input.lines.join("\n"));
      const w = await who(session, meta);
      let created: string[] = [];
      let gone: string[] = [];
      try {
        const saved = await unit.run(session, async (repos) => {
          const before = id ? await repos.policies.get(id) : null;
          if (id && !before) throw notFound();
          const icon = await iconAfter(session, before?.iconPath ?? null, input.icon, input.removeIcon);
          created = icon.created;
          gone = icon.delete;
          const row = before ? await repos.policies.update(before.id, { title, lines, iconPath: icon.path }, session.userId) : await repos.policies.create({ title, lines, iconPath: icon.path }, session.userId);
          await repos.systemLogs.write(
            logLine(w, before
              ? { action: "updated", entity: ENTITY.policies, summary: `Changed House rule card: ${row.title}`, subject: { id: row.id, label: row.title }, details: diffDetails({ title: before.title, lines: before.lines.join(" | ") }, { title: row.title, lines: row.lines.join(" | ") }) }
              : { action: "created", entity: ENTITY.policies, summary: `Added House rule card: ${row.title}`, subject: { id: row.id, label: row.title }, details: { Lines: row.lines.length } }),
          );
          return row;
        });
        await drop(session, gone);
        return policyDto(saved);
      } catch (error) {
        await drop(session, created);
        throw error;
      }
    },

    async saveNearby(session: VerifiedSession, id: string | null, input: { title: string; distanceLabel: string; mapUrl: string; mapQuery: string }, meta: RequestMeta): Promise<WebNearbyPlace> {
      requirePermission(session, catalog, PART, id ? "edit" : "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const before = id ? await repos.nearby.get(id) : null;
        if (id && !before) throw notFound();
        const fields = await nearbyFields(repos, input);
        const row = before ? await repos.nearby.update(before.id, fields, session.userId) : await repos.nearby.create(fields, session.userId);
        await repos.systemLogs.write(
          logLine(w, before
            ? { action: "updated", entity: ENTITY.nearby, summary: `Changed Nearby place: ${row.title}`, subject: { id: row.id, label: row.title }, details: diffDetails({ title: before.title, distance_label: before.distanceLabel, map_url: before.mapUrl ?? "" }, { title: row.title, distance_label: row.distanceLabel, map_url: row.mapUrl ?? "" }) }
            : { action: "created", entity: ENTITY.nearby, summary: `Added Nearby place: ${row.title}`, subject: { id: row.id, label: row.title }, details: { Distance: row.distanceLabel } }),
        );
        return nearbyDto(row);
      });
    },

    /** destroy: the card and its icon file. */
    async remove(session: VerifiedSession, kind: WebListKind, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      const w = await who(session, meta);
      const iconPath = await unit.run(session, async (repos) => {
        const repo = repoOf(repos, kind) as unknown as OrderedRepo<ServiceRecord & PolicyRecord & NearbyRecord, never>;
        const row = await repo.get(id);
        if (!row) throw notFound();
        await repo.remove(id);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: ENTITY[kind], summary: `Deleted ${ENTITY[kind]}: ${row.title}`, subject: { id, label: row.title } }));
        return kind === "nearby" ? null : (row.iconPath ?? null);
      });
      if (iconPath) await drop(session, [iconPath]);
      return { id };
    },

    /** The contract moves a card one place; at an end nothing can move (409). */
    async move(session: VerifiedSession, kind: WebListKind, id: string, direction: "up" | "down", meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const repo = repoOf(repos, kind);
        const list = await repo.list();
        const at = list.findIndex((x) => x.id === id);
        if (at < 0) throw notFound();
        const to = direction === "up" ? at - 1 : at + 1;
        if (to < 0 || to >= list.length) throw conflict("This item cannot move any further.");
        const ids = list.map((x) => x.id);
        [ids[at], ids[to]] = [ids[to], ids[at]];
        await repo.setOrder(ids);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: ENTITY[kind], summary: `Reordered ${ENTITY[kind]}s`, subject: null }));
        return { id };
      });
    },
  };
}

export type ListService = ReturnType<typeof createListService>;
