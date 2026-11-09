import "server-only";
import { randomUUID } from "node:crypto";
import { BLOCKED_MAIL_EXTENSIONS, MAIL_FILES_MAX_BYTES, MAIL_FILES_MAX_COUNT, mailFileProblem } from "@shared/dashboards/mailFiles";
import { AppError } from "../errors";
import type { MailAttachment } from "../services/auth/mail";

// Files for an email (MJ, 2 Nov 2026): a document added to an email waits in the private bucket under mail-files/<hotel id>/<upload id>/<file name> until the email is sent. The email
// then carries the file itself, as an ordinary attachment (the client never sees a link or the bucket). One hour AFTER a successful send the file is removed by the sweep
// (cron); a file that was never sent is removed after a day. Nothing is kept in the database: the bucket holds the state (an empty ".sent" object next to the file marks the send,
// and the time of that object is the time of the send).
// The rules are Gmail's: 25 MB in all, and no program or script file (.exe, .bat, .js ...) because Gmail refuses those too.

export { MAIL_FILES_MAX_BYTES, MAIL_FILES_MAX_COUNT };
/** How long a file stays after the email went when the Super Admin has not set another time (MJ: "1 hour buffer"). */
export const KEEP_AFTER_SEND_MS = 60 * 60 * 1000;
/** How long a file that was never sent stays. */
export const KEEP_UNSENT_MS = 24 * 60 * 60 * 1000;
/** How long the address the browser uploads to works. */
export const UPLOAD_LINK_SECONDS = 15 * 60;

/** The file types Gmail refuses to send or receive (shared/dashboards/mailFiles.ts). */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set(BLOCKED_MAIL_EXTENSIONS);

const TYPES: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", rtf: "application/rtf", odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", zip: "application/zip", mp3: "audio/mpeg", mp4: "video/mp4", mov: "video/quicktime",
};
const extensionOf = (name: string): string => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");
export const mailFileType = (name: string): string => TYPES[extensionOf(name)] ?? "application/octet-stream";

/** A file name safe to keep and to send: no folder, no control character, no leading dot, at most 100 characters; the type stays. */
export function mailFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (base.length <= 100) return base;
  const ext = extensionOf(base);
  return ext !== "" && ext.length <= 10 ? `${base.slice(0, 99 - ext.length)}.${ext}` : base.slice(0, 100);
}

const refuse = (message: string, field = "attachments"): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });

/** The name checked for adding to an email: plain sentences for the page. */
export function checkMailFile(rawName: string, size: number): string {
  const name = mailFileName(rawName);
  const problem = mailFileProblem(name, size);
  if (problem) throw refuse(problem);
  return name;
}

/** Where the bytes of the bucket live. Written once for the bucket, the local folder and the tests. */
export interface RawObjects {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Size in bytes, or null when there is no such object. */
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<{ key: string; size: number; modified: Date }[]>;
  /** An address the browser sends the file to with PUT. Absent = the file goes through the server (a local disk). */
  presignPut?(key: string, expiresSeconds: number): string;
}

export interface MailUpload {
  /** What the email names: "<upload id>/<file name>". */
  ref: string;
  name: string;
  size: number;
  upload: { kind: "put"; url: string } | { kind: "server" };
}

const ROOT = "mail-files/";
const REF = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.{1,100})$/;
const HOTEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseRef(ref: string): { id: string; name: string } {
  const m = REF.exec(ref);
  if (!m) throw refuse("A file of this email could not be found. Add it again.");
  const name = mailFileName(m[2] as string);
  if (name !== m[2]) throw refuse("A file of this email could not be found. Add it again.");
  return { id: m[1] as string, name };
}

/** How many files the sweep deletes at the same time. */
const SWEEP_PARALLEL = 10;

export interface MailFilesOptions {
  /** How long a file stays after its email went, in milliseconds (the Super Admin's setting). Default: KEEP_AFTER_SEND_MS. */
  keepAfterSendMs?: () => Promise<number>;
}

export function createMailFiles(objects: RawObjects, now: () => Date = () => new Date(), options: MailFilesOptions = {}) {
  const keyOf = (hotelId: string, id: string, name: string): string => {
    if (!HOTEL.test(hotelId)) throw new AppError("SERVER_ERROR", "Not a hotel id");
    return `${ROOT}${hotelId}/${id}/${name}`;
  };
  const sentKey = (hotelId: string, id: string): string => keyOf(hotelId, id, ".sent");

  return {
    /** Starts adding a file: checks it and returns where to send it. */
    async begin(hotelId: string, file: { name: string; size: number }): Promise<MailUpload> {
      const name = checkMailFile(file.name, file.size);
      const id = randomUUID();
      const key = keyOf(hotelId, id, name);
      const url = objects.presignPut?.(key, UPLOAD_LINK_SECONDS);
      return { ref: `${id}/${name}`, name, size: file.size, upload: url ? { kind: "put", url } : { kind: "server" } };
    },

    /** The file sent through the server (a local disk, a test). */
    async receive(hotelId: string, ref: string, bytes: Uint8Array): Promise<void> {
      const { id, name } = parseRef(ref);
      checkMailFile(name, bytes.byteLength);
      await objects.put(keyOf(hotelId, id, name), bytes);
    },

    /** The files of an email, read for sending. Refuses a missing file, a changed size or more than 25 MB in all. */
    async load(hotelId: string, refs: readonly string[]): Promise<MailAttachment[]> {
      if (refs.length > MAIL_FILES_MAX_COUNT) throw refuse(`An email can carry ${MAIL_FILES_MAX_COUNT} files at most.`);
      const seen = new Set<string>();
      let total = 0;
      const out: MailAttachment[] = [];
      for (const ref of refs) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const { id, name } = parseRef(ref);
        checkMailFile(name, 1);
        const key = keyOf(hotelId, id, name);
        const size = await objects.size(key);
        if (size === null || size === 0) throw refuse(`${name} did not finish uploading. Add it again.`);
        // the browser chose the size of its upload: it is checked here, before the file is read into memory
        if (total + size > MAIL_FILES_MAX_BYTES) throw refuse(size > MAIL_FILES_MAX_BYTES ? `${name} is too big: an email can carry 25 MB in all.` : "These files are over 25 MB in all. Remove one.");
        const bytes = await objects.get(key);
        if (!bytes) throw refuse(`${name} did not finish uploading. Add it again.`);
        total += bytes.byteLength;
        if (total > MAIL_FILES_MAX_BYTES) throw refuse("These files are over 25 MB in all. Remove one.");
        out.push({ filename: name, contentType: mailFileType(name), content: bytes });
      }
      return out;
    },

    /**
     * The email went: the time of the send is recorded in an empty-looking ".sent" object next to the files (its body is the time, ISO; its own upload time is what the sweep reads, so the
     * sweep needs no extra request). The files are removed the keep time later. Best effort; the sweep still removes an unmarked file after a day.
     */
    async markSent(hotelId: string, refs: readonly string[]): Promise<void> {
      const stamp = new TextEncoder().encode(now().toISOString());
      for (const ref of new Set(refs)) {
        try {
          await objects.put(sentKey(hotelId, parseRef(ref).id), stamp);
        } catch {
          /* the day limit of the sweep covers it */
        }
      }
    },

    /**
     * Removes what is due: files `keep` after their send (the Super Admin's setting, one hour by default), files never sent after a day. One listing of the bucket, then only the due
     * files are deleted, several at a time. A file that cannot be removed now is tried again by the next sweep. Called by the cron and when a file is added.
     */
    async sweep(): Promise<{ removed: number; folders: number }> {
      const at = now().getTime();
      const keep = Math.max(0, options.keepAfterSendMs ? await options.keepAfterSendMs().catch(() => KEEP_AFTER_SEND_MS) : KEEP_AFTER_SEND_MS);
      const folders = new Map<string, { keys: string[]; sentAt: number | null; newest: number }>();
      for (const o of await objects.list(ROOT)) {
        const folder = o.key.split("/").slice(0, 3).join("/");
        const f = folders.get(folder) ?? { keys: [], sentAt: null, newest: 0 };
        f.keys.push(o.key);
        f.newest = Math.max(f.newest, o.modified.getTime());
        if (o.key.endsWith("/.sent")) f.sentAt = o.modified.getTime();
        folders.set(folder, f);
      }
      const due: string[][] = [];
      for (const f of folders.values()) if (f.sentAt !== null ? at - f.sentAt >= keep : at - f.newest >= KEEP_UNSENT_MS) due.push(f.keys);
      // the files first, the ".sent" mark of a folder only when all its files went: a folder that failed half way is still known to be sent, and the next sweep finishes it
      let removed = 0;
      const failed = new Set<string[]>();
      const run = async (items: { key: string; folder: string[] }[]): Promise<void> => {
        for (let i = 0; i < items.length; i += SWEEP_PARALLEL) {
          const chunk = items.slice(i, i + SWEEP_PARALLEL);
          const results = await Promise.allSettled(chunk.map((x) => objects.remove(x.key)));
          results.forEach((r, n) => {
            if (r.status === "fulfilled") removed += 1;
            else failed.add((chunk[n] as { folder: string[] }).folder);
          });
        }
      };
      await run(due.flatMap((folder) => folder.filter((k) => !k.endsWith("/.sent")).map((key) => ({ key, folder }))));
      await run(due.filter((folder) => !failed.has(folder)).flatMap((folder) => folder.filter((k) => k.endsWith("/.sent")).map((key) => ({ key, folder }))));
      return { removed, folders: due.length - failed.size };
    },
  };
}

export type MailFiles = ReturnType<typeof createMailFiles>;

/** The test double: objects in memory, with the time of each put taken from `clock`. */
export function createMemoryObjects(clock: () => Date = () => new Date()): RawObjects & { objects: Map<string, { bytes: Uint8Array; modified: Date }> } {
  const objects = new Map<string, { bytes: Uint8Array; modified: Date }>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, { bytes: new Uint8Array(bytes), modified: clock() });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? new Uint8Array(o.bytes) : null;
    },
    async size(key) {
      return objects.get(key)?.bytes.byteLength ?? null;
    },
    async remove(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.byteLength, modified: o.modified }));
    },
  };
}
