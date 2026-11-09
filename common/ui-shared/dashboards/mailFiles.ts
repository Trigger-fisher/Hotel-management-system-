// Files in an email (MJ, 2 Nov 2026): Gmail's rules, in one place for the server (mail/files.ts), the demo and the Compose window. 25 MB in all, and no program or script file,
// because Gmail refuses those too (https://support.google.com/mail/answer/6590).

export const MAIL_FILES_MAX_BYTES = 25 * 1024 * 1024;
export const MAIL_FILES_MAX_COUNT = 20;

export const BLOCKED_MAIL_EXTENSIONS: readonly string[] =
  "ade adp apk appx appxbundle bat cab chm cmd com cpl dll dmg ex ex_ exe hta ins isp iso jar js jse lib lnk mde msc msi msix msixbundle msp mst nsh pif ps1 scr sct shb sys vb vbe vbs vxd wsc wsf wsh".split(" ");

export const mailFileExtension = (name: string): string => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");

/** The plain sentence for a file that cannot go in an email, or null when it can. */
export function mailFileProblem(name: string, size: number): string | null {
  if (name.trim() === "") return "That file has no name.";
  if (!Number.isInteger(size) || size <= 0) return `${name} is empty.`;
  const ext = mailFileExtension(name);
  if (BLOCKED_MAIL_EXTENSIONS.includes(ext)) return `${name} cannot be sent: Gmail does not allow this kind of file (.${ext}). Send it another way.`;
  if (size > MAIL_FILES_MAX_BYTES) return `${name} is too big: an email can carry 25 MB in all.`;
  return null;
}

/** "86 KB", "2.4 MB". */
export function mailFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A file added to an email and waiting for it: `ref` is what Compose sends. */
export interface EmailFileUpload {
  ref: string;
  name: string;
  size: number;
}

/** How long the files of an email stay in the bucket after the email went (Super Admin: Platform settings > Email files). Whole hours; one hour by default. */
export const MAIL_FILES_KEEP_HOURS_DEFAULT = 1;
export const MAIL_FILES_KEEP_HOURS_MAX = 72;
export const mailFilesKeepHoursProblem = "Enter a whole number of hours from 1 to 72.";
export const validMailFilesKeepHours = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAIL_FILES_KEEP_HOURS_MAX;
