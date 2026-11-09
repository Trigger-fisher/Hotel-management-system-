import "server-only";
import { phpRound } from "../../money/phpFloat";

// Small helpers around map links and the website's list text (Pallav Support/Site/MapTools and the content, policy and place screens). The
// network parts (following a short share link, the road distance) are a PORT (context.ts `MapService`); what is here is pure and golden-tested
// against real PHP.

const PATTERNS = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/];

/** A { lat, lng } pair from a full map link: the pin pair first, then the viewport @lat,lng, then q=lat,lng; null when none is there. */
export function coordinatesFromUrl(url: string): { lat: number; lng: number } | null {
  for (const p of PATTERNS) {
    const m = p.exec(url);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

/** A short share link (maps.app.goo.gl, goo.gl/...) never holds coordinates itself: it has to be followed. */
export const isShortMapLink = (url: string): boolean => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(url);

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Straight-line distance in km (the fallback when routing is unreachable). */
export function straightLineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const group = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "3.2 km": one decimal under 10 km, whole numbers beyond (PHP number_format: half rounds up, thousands with a comma). */
export function kmLabel(km: number): string {
  const places = km < 10 ? 1 : 0;
  const [whole, fraction] = phpRound(km, places).toFixed(places).split(".");
  return `${group(whole)}${fraction ? `.${fraction}` : ""} km`;
}

const ICONS: [readonly string[], string][] = [
  [["airport"], "airport"],
  [["railway", "rail station", "train station"], "rail"],
  [["bus stand", "bus station", "bus depot", "bus stop"], "bus"],
  [["hospital", "clinic", "medical"], "hospital"],
  [["mall", "market", "shopping"], "shopping"],
  [["temple", "mandir", "church", "mosque"], "worship"],
  [["school", "college", "university", "institute"], "school"],
  [["park", "garden"], "park"],
  [["stadium", "ground", "race course"], "stadium"],
];

/** The icon for a nearby place, picked by a keyword in its name (a pin when nothing matches). */
export function placeIcon(title: string): string {
  const t = title.toLowerCase();
  for (const [keywords, name] of ICONS) if (keywords.some((k) => t.includes(k))) return name;
  return "pin";
}

const LINE_BREAK = new RegExp("\r\n|[\n\u000B\u000C\r\u0085\u2028\u2029]");
/** PHP's trim: space, tab, new line, carriage return, NUL and vertical tab. */
const phpTrim = (s: string): string => s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");

/** "0" is falsy in PHP: Laravel's filter() drops a line that is only a zero. */
const truthy = (s: string): boolean => s !== "" && s !== "0";

/** The enquiry section's bullets: one per line, trimmed, blank (and "0") lines dropped. */
export const pointLines = (text: string): string[] => text.split(LINE_BREAK).map(phpTrim).filter(truthy);

/** A house rule card's lines: one per line, each trimmed and kept to 255 characters, blank (and "0") lines dropped, at most fifty. */
export const policyLines = (text: string): string[] =>
  text
    .split(LINE_BREAK)
    .map((l) => Array.from(phpTrim(l)).slice(0, 255).join(""))
    .filter(truthy)
    .slice(0, 50);
