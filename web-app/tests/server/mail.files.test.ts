// The files of an email (mail/files.ts, MJ 2 Nov 2026): Gmail's rules (25 MB in all, no program or script file), the file waits in the bucket until the email is sent, and is removed
// ONE HOUR after a successful send (a file never sent: after a day). The address the browser uploads to is a SigV4 query-string address that an independent check accepts.
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { describe, test } from "node:test";
import { BLOCKED_EXTENSIONS, checkMailFile, createMailFiles, createMemoryObjects, KEEP_AFTER_SEND_MS, KEEP_UNSENT_MS, mailFileName, mailFileType, MAIL_FILES_MAX_BYTES } from "../../src/server/mail/files";
import { presignPutUrl } from "../../src/server/media/s3Objects";
import type { MailAttachment } from "../../src/server/services/auth/mail";
import { hotelWorld, STAFF } from "./helpers/conversations";
import { HOTEL_A, makeSession } from "./helpers/session";

const HOTEL = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5c";
const MB = 1024 * 1024;

function setup(start = new Date("2026-11-02T10:00:00Z")) {
  let t = start.getTime();
  const clock = (): Date => new Date(t);
  const objects = createMemoryObjects(clock);
  const files = createMailFiles(objects, clock);
  return { objects, files, advance: (ms: number): void => void (t += ms) };
}
const refusal = (text: RegExp) => (e: unknown): boolean => (e as { code?: string }).code === "VALIDATION_FAILED" && text.test((e as Error).message);

describe("Gmail's rules for a file in an email", () => {
  test("documents, sheets, photos, archives and audio are allowed; the types get their own content type", () => {
    for (const n of ["bill.pdf", "Offer letter.docx", "rates.xlsx", "deck.pptx", "front.JPG", "notes.txt", "all.zip", "song.mp3", "noextension"]) assert.equal(checkMailFile(n, 1000), n);
    assert.equal(mailFileType("Offer.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(mailFileType("a.unknown"), "application/octet-stream");
  });

  test("every type Gmail refuses is refused, in any letter case", () => {
    assert.ok(BLOCKED_EXTENSIONS.has("exe") && BLOCKED_EXTENSIONS.has("js") && BLOCKED_EXTENSIONS.has("bat") && BLOCKED_EXTENSIONS.has("msi") && BLOCKED_EXTENSIONS.has("vbs"));
    for (const n of ["setup.exe", "RUN.BAT", "a.js", "x.msi", "y.Vbs", "z.scr", "w.jar", "d.iso"]) assert.throws(() => checkMailFile(n, 1000), refusal(/Gmail does not allow/), n);
  });

  test("an empty file or one over 25 MB is refused; exactly 25 MB passes", () => {
    assert.throws(() => checkMailFile("a.pdf", 0), refusal(/is empty/));
    assert.throws(() => checkMailFile("a.pdf", MAIL_FILES_MAX_BYTES + 1), refusal(/25 MB/));
    assert.equal(checkMailFile("a.pdf", MAIL_FILES_MAX_BYTES), "a.pdf");
  });

  test("a file name cannot name a folder, start with a dot or carry control characters", () => {
    assert.equal(mailFileName("..\\..\\etc/passwd"), "passwd");
    assert.equal(mailFileName(".hidden.pdf"), "hidden.pdf");
    assert.equal(mailFileName("a\u0000b\nc.pdf"), "abc.pdf");
    assert.ok(mailFileName(`${"x".repeat(300)}.pdf`).length <= 100 && mailFileName(`${"x".repeat(300)}.pdf`).endsWith(".pdf"));
  });
});

describe("the file waits in the bucket, goes with the email, and is removed an hour after the send", () => {
  test("begin names the file under the hotel and an upload id; load reads it back for sending", async () => {
    const { files, objects } = setup();
    const up = await files.begin(HOTEL, { name: "Offer letter.docx", size: 5 });
    assert.match(up.ref, /^[0-9a-f-]{36}\/Offer letter\.docx$/);
    assert.deepEqual(up.upload, { kind: "server" }, "the memory objects have no direct address, so the file goes through the server");
    await files.receive(HOTEL, up.ref, new Uint8Array([1, 2, 3, 4, 5]));
    assert.deepEqual([...objects.objects.keys()], [`mail-files/${HOTEL}/${up.ref}`]);
    const out = await files.load(HOTEL, [up.ref]);
    assert.deepEqual(out.map((a) => [a.filename, a.contentType, a.content.byteLength]), [["Offer letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5]]);
  });

  test("another hotel can never read the file, and a made-up reference finds nothing", async () => {
    const { files } = setup();
    const up = await files.begin(HOTEL, { name: "a.pdf", size: 3 });
    await files.receive(HOTEL, up.ref, new Uint8Array([1, 2, 3]));
    await assert.rejects(() => files.load(OTHER, [up.ref]), refusal(/did not finish uploading/));
    for (const bad of ["../../x/a.pdf", "not-a-ref", `${up.ref}/../b`, "00000000-0000-0000-0000-000000000000/../../b.pdf"]) await assert.rejects(() => files.load(HOTEL, [bad]), refusal(/could not be found|did not finish/), bad);
  });

  test("a file that never finished uploading is refused with a sentence; so are more than 25 MB in all and a blocked name", async () => {
    const { files, objects } = setup();
    const a = await files.begin(HOTEL, { name: "a.pdf", size: 100 });
    await assert.rejects(() => files.load(HOTEL, [a.ref]), refusal(/did not finish uploading/));
    const big1 = await files.begin(HOTEL, { name: "one.pdf", size: 20 * MB });
    const big2 = await files.begin(HOTEL, { name: "two.pdf", size: 20 * MB });
    await objects.put(`mail-files/${HOTEL}/${big1.ref}`, new Uint8Array(20 * MB));
    await objects.put(`mail-files/${HOTEL}/${big2.ref}`, new Uint8Array(20 * MB));
    await assert.rejects(() => files.load(HOTEL, [big1.ref, big2.ref]), refusal(/over 25 MB in all/));
    // the size the browser claimed is not trusted: a bigger object than 25 MB is refused before it is read
    const lie = await files.begin(HOTEL, { name: "lie.pdf", size: 10 });
    await objects.put(`mail-files/${HOTEL}/${lie.ref}`, new Uint8Array(26 * MB));
    await assert.rejects(() => files.load(HOTEL, [lie.ref]), refusal(/too big/));
    await assert.rejects(() => files.load(HOTEL, [`${a.ref.split("/")[0]}/virus.exe`]), refusal(/Gmail does not allow/));
  });

  test("ONE HOUR after a successful send the file is removed, not before", async () => {
    const { files, objects, advance } = setup();
    const up = await files.begin(HOTEL, { name: "bill.pdf", size: 3 });
    await files.receive(HOTEL, up.ref, new Uint8Array([1, 2, 3]));
    await files.load(HOTEL, [up.ref]);
    await files.markSent(HOTEL, [up.ref]);
    assert.equal(objects.objects.size, 2, "the file and the .sent mark");
    advance(KEEP_AFTER_SEND_MS - 1000);
    assert.deepEqual(await files.sweep(), { removed: 0, folders: 0 });
    assert.equal(objects.objects.size, 2, "59 minutes 59 seconds: still there");
    advance(1000);
    assert.deepEqual(await files.sweep(), { removed: 2, folders: 1 });
    assert.equal(objects.objects.size, 0, "an hour after the send: the file and its mark are gone");
  });

  test("the keep time is the Super Admin's setting, read at each sweep; the send time is written in the mark; the mark goes only after its files, so a failed delete is retried", async () => {
    let hours = 3;
    let t = new Date("2026-11-02T10:00:00Z").getTime();
    const clock = (): Date => new Date(t);
    const objects = createMemoryObjects(clock);
    const files = createMailFiles(objects, clock, { keepAfterSendMs: async () => hours * 3_600_000 });
    const up = await files.begin(HOTEL, { name: "a.pdf", size: 1 });
    await files.receive(HOTEL, up.ref, new Uint8Array([1]));
    await files.markSent(HOTEL, [up.ref]);
    const mark = [...objects.objects.entries()].find(([k]) => k.endsWith("/.sent"));
    assert.equal(new TextDecoder().decode(mark?.[1].bytes), "2026-11-02T10:00:00.000Z", "the time of the send");
    t += 2 * 3_600_000 + 59 * 60_000;
    assert.deepEqual(await files.sweep(), { removed: 0, folders: 0 }, "under 3 hours: kept");
    hours = 2;
    assert.deepEqual(await files.sweep(), { removed: 2, folders: 1 }, "the setting was lowered to 2 hours: due now");
    // a delete that fails leaves the mark, so the next sweep finishes the folder
    const up2 = await files.begin(HOTEL, { name: "b.pdf", size: 1 });
    await files.receive(HOTEL, up2.ref, new Uint8Array([1]));
    await files.markSent(HOTEL, [up2.ref]);
    t += 3 * 3_600_000;
    const real = objects.remove;
    objects.remove = async (k: string) => {
      if (!k.endsWith("/.sent")) throw new Error("bucket busy");
      return real(k);
    };
    assert.deepEqual(await files.sweep(), { removed: 0, folders: 0 }, "the file failed, so the mark stays");
    assert.ok([...objects.objects.keys()].some((k) => k.endsWith("/.sent")));
    objects.remove = real;
    assert.deepEqual(await files.sweep(), { removed: 2, folders: 1 });
    assert.equal(objects.objects.size, 0);
  });

  test("a failed send keeps the file for the retry (the hour does not start); a file never sent goes after a day", async () => {
    const { files, objects, advance } = setup();
    const up = await files.begin(HOTEL, { name: "bill.pdf", size: 3 });
    await files.receive(HOTEL, up.ref, new Uint8Array([1, 2, 3]));
    advance(5 * 60 * 60 * 1000);
    assert.deepEqual(await files.sweep(), { removed: 0, folders: 0 }, "five hours, no send: kept");
    assert.equal((await files.load(HOTEL, [up.ref])).length, 1, "the retry can still read it");
    advance(KEEP_UNSENT_MS);
    assert.deepEqual(await files.sweep(), { removed: 1, folders: 1 });
    assert.equal(objects.objects.size, 0);
  });

  test("the hour is counted per email: a later email's files are not removed with an earlier one's", async () => {
    const { files, objects, advance } = setup();
    const first = await files.begin(HOTEL, { name: "a.pdf", size: 1 });
    await files.receive(HOTEL, first.ref, new Uint8Array([1]));
    await files.markSent(HOTEL, [first.ref]);
    advance(KEEP_AFTER_SEND_MS / 2);
    const second = await files.begin(HOTEL, { name: "b.pdf", size: 1 });
    await files.receive(HOTEL, second.ref, new Uint8Array([2]));
    await files.markSent(HOTEL, [second.ref]);
    advance(KEEP_AFTER_SEND_MS / 2);
    assert.deepEqual(await files.sweep(), { removed: 2, folders: 1 });
    assert.deepEqual([...objects.objects.keys()].filter((k) => !k.endsWith(".sent")).map((k) => k.endsWith("b.pdf")), [true]);
  });
});

describe("the address the browser uploads to", () => {
  const options = { endpoint: "https://abc.storage.supabase.co/storage/v1/s3", bucket: "hms-media", region: "ap-south-1", accessKeyId: "AKIATESTACCESSKEY01", secretAccessKey: "test/Secret+Key-0123456789", forcePathStyle: true };

  test("is a SigV4 query-string address for PUT that an independent check accepts, and it carries no secret", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    const url = new URL(presignPutUrl(options, `mail-files/${HOTEL}/0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5d/Offer letter.docx`, 900, now));
    assert.equal(url.host, "abc.storage.supabase.co");
    assert.equal(url.pathname, `/storage/v1/s3/hms-media/mail-files/${HOTEL}/0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5d/Offer%20letter.docx`);
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(url.searchParams.get("X-Amz-Date"), "20261102T100000Z");
    assert.ok(!url.href.includes(options.secretAccessKey) && !url.href.includes("Secret"));
    // the check: rebuild the signature from the received address, the way an S3 server does
    const given = url.searchParams.get("X-Amz-Signature") ?? "";
    const query = [...url.searchParams.entries()].filter(([k]) => k !== "X-Amz-Signature").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`).sort().join("&");
    const canonical = ["PUT", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const scope = "20261102/ap-south-1/s3/aws4_request";
    const toSign = ["AWS4-HMAC-SHA256", "20261102T100000Z", scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const h = (k: Buffer | string, d: string): Buffer => createHmac("sha256", k).update(d).digest();
    const key = h(h(h(h(`AWS4${options.secretAccessKey}`, "20261102"), "ap-south-1"), "s3"), "aws4_request");
    assert.equal(createHmac("sha256", key).update(toSign).digest("hex"), given);
  });
});

describe("Compose with files, end to end: added, sent as attachments, removed an hour after", () => {
  const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
  const META = { traceId: "t1", ip: null };
  const hotelMail = (failFirst = false) => {
    const sent: { to: string; cc: readonly string[]; files: string[][] }[] = [];
    let failed = !failFirst;
    return {
      sent,
      send: async (_hotelId: string, mail: { to: string; cc?: readonly string[]; attachments?: MailAttachment[]; bill?: boolean }) => {
        if (!failed) {
          failed = true;
          throw new Error("down");
        }
        sent.push({ to: mail.to, cc: mail.cc ?? [], files: [(mail.attachments ?? []).map((a) => `${a.filename}|${a.contentType}|${a.content.byteLength}|bill=${String(mail.bill)}`)] });
        return { messageId: `<out-${sent.length}@hms.mail>`, sentAt: new Date("2026-11-02T10:00:00Z") };
      },
    };
  };
  async function add(files: ReturnType<typeof createMailFiles>, name: string, bytes: Uint8Array): Promise<string> {
    const up = await files.begin(HOTEL_A, { name, size: bytes.byteLength });
    await files.receive(HOTEL_A, up.ref, bytes);
    return up.ref;
  }

  test("the email goes with the files attached (not as links); the files are marked and removed one hour after", async () => {
    const { files, objects, advance } = setup();
    const mail = hotelMail();
    const w = hotelWorld({ provider: "platform", sendHotelMail: mail.send, mailFiles: files });
    const doc = await add(files, "Offer letter.docx", new Uint8Array(5000));
    const sheet = await add(files, "rates.xlsx", new Uint8Array(7000));
    await w.service.compose(admin, { to: "asha@guest.in", subject: "Your offer", text: "Please find the files attached.", attachments: [doc, sheet] }, META);
    assert.deepEqual(mail.sent, [{ to: "asha@guest.in", cc: [], files: [["Offer letter.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document|5000|bill=false", "rates.xlsx|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|7000|bill=false"]] }]);
    assert.equal([...objects.objects.keys()].filter((k) => k.endsWith("/.sent")).length, 2, "both files are marked as sent");
    assert.equal(w.data().convMessages.find((m) => m.direction === "out")?.hasAttachments, true);
    advance(KEEP_AFTER_SEND_MS - 1000);
    await w.service.sweepFiles();
    assert.equal(objects.objects.size, 4, "59 minutes 59 seconds after the send: the files are still there");
    advance(1000);
    assert.deepEqual(await w.service.sweepFiles(), { removed: 4, folders: 2 });
    assert.equal(objects.objects.size, 0);
  });

  test("a send that fails keeps the files so the retry works; the hour starts only after the send that worked", async () => {
    const { files, objects, advance } = setup();
    const mail = hotelMail(true);
    const w = hotelWorld({ provider: "platform", sendHotelMail: mail.send, mailFiles: files });
    const ref = await add(files, "bill.pdf", new Uint8Array(100));
    await assert.rejects(() => w.service.compose(admin, { to: "asha@guest.in", subject: "Bill", text: "Attached.", attachments: [ref] }, META));
    assert.equal([...objects.objects.keys()].filter((k) => k.endsWith("/.sent")).length, 0, "nothing marked: the email did not go");
    advance(3 * 60 * 60 * 1000);
    await w.service.sweepFiles();
    assert.equal(objects.objects.size, 1, "three hours later the unsent file is still there");
    await w.service.compose(admin, { to: "asha@guest.in", subject: "Bill", text: "Attached.", attachments: [ref] }, META);
    assert.equal(mail.sent.length, 1);
    advance(KEEP_AFTER_SEND_MS);
    await w.service.sweepFiles();
    assert.equal(objects.objects.size, 0);
  });

  test("a Cc is one email with a real Cc header that carries the files; a draft and a mail without files change nothing in the bucket; a blocked name is refused before anything is sent", async () => {
    const { files, objects } = setup();
    const mail = hotelMail();
    const w = hotelWorld({ provider: "platform", sendHotelMail: mail.send, mailFiles: files });
    const ref = await add(files, "plan.pdf", new Uint8Array(10));
    await w.service.compose(admin, { to: "asha@guest.in", cc: ["boss@hotel.in"], subject: "Plan", text: "Attached.", attachments: [ref] }, META);
    assert.deepEqual(mail.sent.map((s) => [s.to, s.cc, s.files[0]?.length]), [["asha@guest.in", ["boss@hotel.in"], 1]], "one email to Asha, Cc to the boss, with the file");
    const before = objects.objects.size;
    await w.service.compose(admin, { to: "asha@guest.in", subject: "Plain", text: "No files." }, META);
    assert.equal(mail.sent.length, 2);
    assert.deepEqual(mail.sent[1].cc, [], "no Cc, no Cc header");
    assert.equal(objects.objects.size, before);
    await assert.rejects(() => w.service.compose(admin, { to: "asha@guest.in", subject: "Bad", text: "x", attachments: [`${ref.split("/")[0]}/setup.exe`] }, META), refusal(/Gmail does not allow/));
    assert.equal(mail.sent.length, 2, "nothing was sent");
  });

  test("a server with no bucket answers a plain sentence for a file, and an email without files still goes", async () => {
    const mail = hotelMail();
    const w = hotelWorld({ provider: "platform", sendHotelMail: mail.send });
    await assert.rejects(() => w.service.compose(admin, { to: "asha@guest.in", subject: "x", text: "y", attachments: ["11111111-1111-4111-8111-111111111111/a.pdf"] }, META), (e: unknown) => /Files cannot be added/.test((e as Error).message));
    await w.service.compose(admin, { to: "asha@guest.in", subject: "x", text: "y" }, META);
    assert.equal(mail.sent.length, 1);
  });
});
