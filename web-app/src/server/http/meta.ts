import "server-only";
import { clientAddress } from "./clientAddress";

/** What a service may know about the request it serves: the trace id and the caller's address (for the system log). */
export interface RequestMeta {
  traceId: string;
  ip: string | null;
}

const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/** The caller's address from the trusted proxy's entry of the header (http/clientAddress.ts) when it looks like an address; otherwise null. */
export function requestMeta(request: Request, traceId: string): RequestMeta {
  const ip = clientAddress(request);
  return { traceId, ip: ip !== null && IP_SHAPE.test(ip) ? ip : null };
}
