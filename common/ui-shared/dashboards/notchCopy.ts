// The words of the top notch (shell/Notch.tsx): one place where a notice or an announcement slides in from the top like an Apple notch.
export const notchCopy = {
  announcement: 'Announcement',
  notice: 'Notice',
  important: 'Important',
  accept: 'Accept',
  view: 'View',
  close: 'Close',
  more: (n: number) => `and ${n} more`,
  region: 'New messages',
} as const;
