// Which page instance the shell keeps (RoleDashboard). A page is drawn anew when its key changes. The Email and WhatsApp pages (MJ, 5 Nov 2026: "no refresh") keep ONE instance
// while the person moves between their list and their threads (a thread is its own address, pushed on the stack, so Back and a link still work), switches box or folder, or taps
// the menu entry again: the list and the open thread change in place.

/** The page a view belongs to when it is the Email or WhatsApp page of a console (its list or one of its threads), else null. */
export function liveFamilyOf(viewId: string): string | null {
  const m = /^(hotel|platform|group)\.(email|emailThread|whatsapp|whatsappThread|myMailbox|myMailboxThread|conversations|conversation)$/.exec(viewId);
  if (!m) return null;
  const page = m[2];
  const base = page === 'conversation' ? 'conversations' : page.replace(/Thread$/, '');
  return `${m[1]}.${base}`;
}

/** The key of the page on top of the stack: for the Email and WhatsApp pages the family and the depth of its first entry; for every other page the view, the depth and its reset count. */
export function pageKeyOf(stack: readonly { viewId: string; reset?: number }[]): string {
  const top = stack[stack.length - 1];
  if (!top) return '';
  const family = liveFamilyOf(top.viewId);
  if (!family) return `${top.viewId}:${stack.length}:${top.reset ?? 0}`;
  let i = stack.length - 1;
  while (i > 0 && liveFamilyOf(stack[i - 1].viewId) === family) i -= 1;
  return `${family}:${i + 1}`;
}
