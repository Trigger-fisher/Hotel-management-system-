import "server-only";
import { randomUUID } from "node:crypto";
import type { IdReading } from "@shared/dashboards/frontOffice";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { sniffImage } from "../../media/store";
import { actorOf, logLine, type FrontOfficeDeps } from "./context";
import { hasFields, isFinished, readingOf, type IntakeJobState } from "./idReading";

// Reading the ID pictures of a check-in through the reader worker. HMS puts each picture in the private bucket under a short-lived name, queues one job per picture
// (intake_jobs), and waits for the worker's FAST part (the form fields; the worker's picture is never used: the desk's own photos are saved by the id-photo routes).
// Nothing here logs a name, a number or a picture; the system log says only how many pictures and people.
const PART = "pms.stays";
export const MAX_READ_PICTURES = 8;
export const MAX_READ_PICTURE_BYTES = 8 * 1024 * 1024;
export const READ_WAIT_MS = 25_000;
const LINK_SECONDS = 900;
const POLL_MS = [400, 500, 700, 900, 1200, 1500];

export const READER_NOT_CONNECTED = "ID reading is not switched on for this hotel yet. Please type the details in.";
export const READER_BUSY = "The reader is busy. Try again or type it in.";

export interface NewIntakeJob {
  id: string;
  hotelId: string;
  downloadUrl: string;
  uploadUrl: string;
  wrappedKey: string;
}

/** The reader's two doors: the queue (its database) and the quarantine files (the private bucket). */
export interface ReaderBridge {
  insert(job: NewIntakeJob): Promise<void>;
  states(hotelId: string, ids: string[]): Promise<IntakeJobState[]>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  readUrl(key: string, seconds: number): string;
  writeUrl(key: string, seconds: number): string;
  wrap(hotelId: string): string;
  /** Removes the quarantine files older than the reader needs them. Never throws. */
  sweep(): Promise<void>;
}

export interface ReadFile {
  fileName: string;
  dataBase64: string;
}

const notConnected = (): AppError => new AppError("CONFLICT", READER_NOT_CONNECTED, { reason: "reader_not_connected" });
const busy = (): AppError => new AppError("CONFLICT", READER_BUSY, { reason: "reader_busy" });
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function createIdReadService(deps: Pick<FrontOfficeDeps, "unit" | "people" | "catalog"> & { bridge: ReaderBridge | null; wait?: (ms: number) => Promise<void>; waitMs?: number }) {
  const { unit, catalog, bridge } = deps;
  const wait = deps.wait ?? sleep;
  const deadline = deps.waitMs ?? READ_WAIT_MS;

  function pictures(files: ReadFile[]): Uint8Array[] {
    if (files.length < 1 || files.length > MAX_READ_PICTURES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { files: `Add 1 to ${MAX_READ_PICTURES} pictures.` } });
    return files.map((f, i) => {
      const bytes = new Uint8Array(Buffer.from(f.dataBase64, "base64"));
      const type = sniffImage(bytes);
      const fail = (why: string) => new AppError("VALIDATION_FAILED", undefined, { fields: { files: `Picture ${i + 1}: ${why}` } });
      if (bytes.length === 0) throw fail("that file could not be read.");
      if (bytes.length > MAX_READ_PICTURE_BYTES) throw fail("that file is too big (8 MB at most).");
      if (type !== "jpg" && type !== "png") throw fail("pick a JPG or PNG image.");
      return bytes;
    });
  }

  return {
    async read(session: VerifiedSession, input: { files: ReadFile[] }, meta: RequestMeta): Promise<IdReading> {
      requirePermission(session, catalog, PART, "edit");
      if (!bridge) throw notConnected();
      const bytes = pictures(input.files);
      void bridge.sweep();
      const ids: string[] = [];
      for (const b of bytes) {
        const id = randomUUID();
        const inKey = `intake-quarantine/${session.hotelId}/${id}.in`;
        const outKey = `intake-quarantine/${session.hotelId}/${id}.out`;
        try {
          await bridge.put(inKey, b);
          await bridge.insert({ id, hotelId: session.hotelId, downloadUrl: bridge.readUrl(inKey, LINK_SECONDS), uploadUrl: bridge.writeUrl(outKey, LINK_SECONDS), wrappedKey: bridge.wrap(session.hotelId) });
        } catch {
          throw notConnected();
        }
        ids.push(id);
      }
      const states = await this.waitFor(session.hotelId, ids);
      const worked = states.filter((s) => s.status !== "needs_attention");
      if (worked.length === 0) throw busy();
      const reading = readingOf(worked);
      const w = { session, meta, actor: await actorOf(deps, session) };
      const people = 1 + (reading.others?.length ?? 0);
      await unit.run(session, (repos) =>
        repos.systemLogs.write(
          logLine(w, { action: "created", entity: "ID reading", summary: `ID read: ${bytes.length} picture${bytes.length === 1 ? "" : "s"}, ${reading.outcome === "read" ? `${people} ${people === 1 ? "person" : "people"}` : "not clear"}`, subject: null }),
        ),
      );
      return reading;
    },

    /** Polls the queue until every job has its fast result, or the wait is over (then the reader is busy). */
    async waitFor(hotelId: string, ids: string[]): Promise<IntakeJobState[]> {
      const started = Date.now();
      for (let i = 0; ; i++) {
        let states: IntakeJobState[];
        try {
          states = await (bridge as ReaderBridge).states(hotelId, ids);
        } catch {
          throw notConnected();
        }
        if (states.length === ids.length && states.every(isFinished)) return states;
        if (Date.now() - started >= deadline) {
          // a picture still waiting is not worth a half answer when nothing was read yet
          if (!states.some(hasFields)) throw busy();
          return states.filter(isFinished);
        }
        await wait(POLL_MS[Math.min(i, POLL_MS.length - 1)]);
      }
    },
  };
}

export type IdReadService = ReturnType<typeof createIdReadService>;
