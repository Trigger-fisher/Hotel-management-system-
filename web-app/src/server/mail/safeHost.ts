import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// Connections to a mailbox only go to PUBLIC mail servers (decision 66, A13): a host typed in Settings (an own IMAP or SMTP server) could otherwise point HMS at the
// server's own network (a cloud metadata address, a database, a private service). The name is resolved ONCE here; every address must be public; the connection is then made
// to that resolved address with the TLS name check against the host (servername), so the name cannot be switched to a private address between the check and the connect
// (DNS rebinding). Bare IP addresses and "localhost" are refused already when the settings are saved.

export type MailHostErrorCode = "HOST_PRIVATE" | "HOST_INVALID" | "HOST_UNRESOLVED";

export class MailHostError extends Error {
  readonly code: MailHostErrorCode;
  constructor(code: MailHostErrorCode) {
    super(code === "HOST_PRIVATE" ? "This server address is not on the internet." : code === "HOST_INVALID" ? "This is not a valid server name." : "This server name could not be found.");
    this.name = "MailHostError";
    this.code = code;
  }
}

const NAME = /^[A-Za-z0-9.-]{1,253}$/;

/** A server name a person may save: letters, digits, dots and dashes with at least one dot; never "localhost", a ".localhost" name or a bare IP address. */
export function isSafeHostName(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!NAME.test(h) || !h.includes(".") || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (isIP(h) !== 0) return false;
  // a dotted name made only of digits is an IPv4 address in another spelling (1.2.3, 0x7f.1)
  if (/^((0x[0-9a-f]*|[0-9]+)\.?)+$/.test(h)) return false;
  return true;
}

const v4ToNumber = (ip: string): number => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const inV4 = (ip: number, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((v4ToNumber(base) & mask) >>> 0);
};
const PRIVATE_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return true;
  const n = v4ToNumber(ip);
  return PRIVATE_V4.some(([base, bits]) => inV4(n, base, bits));
}

/** The 8 groups of an IPv6 address as numbers (an embedded IPv4 tail counts as two). */
function v6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const n = v4ToNumber(v4[1]);
    text = `${text.slice(0, -v4[1].length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  // ::ffff:a.b.c.d (IPv4-mapped), ::a.b.c.d (IPv4-compatible) and 64:ff9b::a.b.c.d (NAT64): judged by the IPv4 address inside
  const embedded = `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embedded);
  return false;
}

/** Is this address one HMS may never connect to (loopback, private, link-local, carrier NAT, unique local, multicast, reserved)? */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPrivateV4(address);
  if (kind === 6) return isPrivateV6(address);
  return true;
}

export type HostLookup = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultLookup: HostLookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * The address to connect to for this mail server, and the name to check its certificate against. Throws MailHostError: HOST_INVALID (not a server name), HOST_UNRESOLVED
 * (no address), HOST_PRIVATE (any of its addresses is not public: one bad answer is enough to refuse).
 */
export async function resolvePublicHost(host: string, options: { lookup?: HostLookup } = {}): Promise<{ address: string; servername: string }> {
  const servername = host.trim().toLowerCase();
  if (!isSafeHostName(servername)) throw new MailHostError(isIP(servername) !== 0 || servername === "localhost" || servername.endsWith(".localhost") ? "HOST_PRIVATE" : "HOST_INVALID");
  let answers: { address: string; family: number }[];
  try {
    answers = await (options.lookup ?? defaultLookup)(servername);
  } catch {
    throw new MailHostError("HOST_UNRESOLVED");
  }
  if (answers.length === 0) throw new MailHostError("HOST_UNRESOLVED");
  if (answers.some((a) => isPrivateAddress(a.address))) throw new MailHostError("HOST_PRIVATE");
  return { address: answers[0].address, servername };
}
