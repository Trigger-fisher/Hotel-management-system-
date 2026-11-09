import "server-only";
// A fake Meta for tests (plan part 28.7): a `fetch` that answers the Graph API endpoints graph.ts uses, records every call and does what the test scripts it to do. No network.
// Answers are queued for message sends (POST /{phone_number_id}/messages with a message, not a read mark); when the queue is empty a send answers ok with the next deterministic wamid
// ("wamid.FAKE0001", "wamid.FAKE0002" ...). The other endpoints always answer ok.
import type { FetchLike } from "./graph";

export type FakeAnswer =
  | { type: "ok" }
  | { type: "policy"; code?: number }
  | { type: "429" }
  | { type: "5xx" }
  | { type: "401" }
  /** Never answers: the caller's timeout aborts it (an unknown outcome for a send). */
  | { type: "hang" }
  /** The connection drops after the request was sent. */
  | { type: "reset" }
  /** The connection never opens (DNS or refused): nothing reached Meta. */
  | { type: "refused" };

export interface FakeCall {
  method: string;
  /** Path and query, without the host. */
  path: string;
  host: string;
  authorization: string | null;
  body: Record<string, unknown> | null;
}

export interface FakeMeta {
  fetch: FetchLike;
  calls: FakeCall[];
  /** Queue answers for the next message sends, in order. */
  script(...answers: FakeAnswer[]): void;
  /** Message sends only (not read marks or other endpoints). */
  sends(): FakeCall[];
  /** Runs when a message send arrives, before it is answered (a test can look at the stores then). */
  onSend(fn: (call: FakeCall) => void): void;
  /** What the next media downloads answer (the bytes and the type Meta declares). */
  setMedia(bytes: Uint8Array, mime: string): void;
  /** Meta decides on a submitted template: APPROVED, REJECTED (with a reason) or PAUSED. */
  decide(name: string, status: "APPROVED" | "REJECTED" | "PAUSED", reason?: string | null): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const error = (status: number, code: number): Response => json(status, { error: { message: "fake", type: "FakeException", code, fbtrace_id: "FAKE" } });

export function createFakeMeta(): FakeMeta {
  const calls: FakeCall[] = [];
  const queue: FakeAnswer[] = [];
  let seq = 0;
  let sendHook: ((call: FakeCall) => void) | null = null;
  const templates = new Map<string, { id: string; status: string; reason: string | null }>();
  // what a media download answers (default: sixteen plain bytes, as before)
  const media: { bytes: Uint8Array; mime: string } = { bytes: new Uint8Array(Buffer.from("fake-media-bytes")), mime: "image/jpeg" };

  const answerSend = (answer: FakeAnswer | undefined, signal: AbortSignal | null | undefined): Promise<Response> => {
    switch (answer?.type ?? "ok") {
      case "policy":
        return Promise.resolve(error(400, (answer as { code?: number }).code ?? 131047));
      case "429":
        return Promise.resolve(json(429, { error: { code: 130429, message: "fake" } }, { "retry-after": "7" }));
      case "5xx":
        return Promise.resolve(error(503, 2));
      case "401":
        return Promise.resolve(error(401, 190));
      case "hang":
        return new Promise((_, reject) => {
          const abort = (): void => reject(new DOMException("The operation was aborted", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort);
        });
      case "reset":
        return Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));
      case "refused":
        return Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
      default:
        seq += 1;
        return Promise.resolve(json(200, { messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: `wamid.FAKE${String(seq).padStart(4, "0")}` }] }));
    }
  };

  const fakeFetch: FetchLike = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    const authorization = new Headers(init?.headers).get("authorization");
    const call: FakeCall = { method, path: url.pathname + url.search, host: url.host, authorization, body };
    calls.push(call);

    if (url.host === "lookaside.fake") return new Response(Buffer.from(media.bytes), { status: 200, headers: { "content-type": media.mime } });
    const parts = url.pathname.split("/").filter(Boolean); // [version, id, ...]
    if (method === "POST" && parts[2] === "messages") {
      if (body?.status === "read") return json(200, { success: true });
      sendHook?.(call);
      return answerSend(queue.shift(), init?.signal);
    }
    if (method === "POST" && (parts[2] === "register" || parts[2] === "subscribed_apps")) return json(200, { success: true });
    // templates: a submitted one is kept by name and waits for approval until a test or the demo approves it (fake.approve)
    if (parts[2] === "message_templates") {
      if (method === "POST") {
        const name = String(body?.name ?? "");
        if (templates.has(name)) return error(400, 2388023);
        templates.set(name, { id: `tpl.FAKE${templates.size + 1}`, status: "PENDING", reason: null });
        return json(200, { id: templates.get(name)?.id, status: "PENDING", category: body?.category });
      }
      const name = url.searchParams.get("name") ?? "";
      if (method === "DELETE") return templates.delete(name) ? json(200, { success: true }) : error(404, 100);
      const t = templates.get(name);
      return json(200, { data: t ? [{ id: t.id, name, status: t.status, rejected_reason: t.reason ?? "NONE" }] : [] });
    }
    if (method === "GET" && parts.length === 2 && url.searchParams.has("fields")) {
      return json(200, { id: parts[1], display_phone_number: "+1 555 000 1111", verified_name: "Fake Hotel", quality_rating: "GREEN", messaging_limit_tier: "TIER_250" });
    }
    if (method === "GET" && parts.length === 2) return json(200, { id: parts[1], url: "https://lookaside.fake/media/" + parts[1], mime_type: media.mime, sha256: "abc", file_size: media.bytes.length });
    return error(404, 100);
  };

  return {
    fetch: fakeFetch,
    calls,
    script: (...answers) => void queue.push(...answers),
    sends: () => calls.filter((c) => c.method === "POST" && c.path.includes("/messages") && c.body?.status !== "read"),
    onSend: (fn) => {
      sendHook = fn;
    },
    setMedia: (bytes, mime) => {
      media.bytes = bytes;
      media.mime = mime;
    },
    decide: (name, status, reason = null) => {
      const t = templates.get(name);
      if (t) {
        t.status = status;
        t.reason = reason;
      }
    },
  };
}
