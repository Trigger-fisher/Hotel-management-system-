// The Guest and Company portals when the signed-in account is in the hotel but not linked to a guest or company record (decision 47; the Employee portal was removed, decision 58).
// The server answers 409 with its own code PORTAL_NOT_LINKED (no record) or PORTAL_INACTIVE (a record that is switched off), a plain sentence in `message`
// and `details.fields.portal`. The screens never show "Not allowed" for that: they show a friendly page (PtNotSetUp in groups/portal/parts.tsx).
import type { DashError } from './common';

export type PortalKind = 'guest' | 'company';

export interface PortalNotSetUp {
  portal: PortalKind | null;
  /** PORTAL_INACTIVE: the record exists but is switched off. */
  inactive: boolean;
  /** The server's sentence, or ours when it sent none. */
  message: string;
}

export const portalCopy = {
  notSetUpTitle: 'Your account is not set up yet',
  inactiveTitle: 'Your profile is switched off',
  todo: 'What to do: ask the hotel front desk to link your account. It takes a minute, and then this page works.',
  inactiveTodo: 'What to do: ask the hotel front desk to switch your profile on again.',
  contact: (hotel: string | null): string => (hotel ? `Contact ${hotel} and tell them the name you sign in with.` : 'Contact the hotel and tell them the name you sign in with.'),
  fallback: {
    guest: 'Your account is not linked to a guest profile yet. Please ask the hotel front desk to link it.',
    company: 'Your account is not linked to a company profile yet. Please ask the hotel front desk to link it.',
    inactive: 'Your profile is not active at the moment. Please ask the hotel front desk.',
  },
  /** A short "What you can do here" on the first page of each portal. */
  intro: {
    title: 'What you can do here',
    guest: [
      'See your stay and what you owe the hotel.',
      'Open all your bills, with the persons and the amounts, and pay the ones that are due.',
      'See every payment you have made, latest first.',
      'Order food, laundry and room service to your room while you stay.',
      'See your details on record and change your password.',
    ],
    company: [
      'See what your company owes the hotel and what it has paid.',
      'Open any bill to see the stay, the persons and the amounts.',
      'Check the ledger of your account, hotel by hotel.',
      'Keep your company contact details up to date.',
    ],
  },
} as const;

/** The friendly page's data when `error` is a portal "not linked" or "inactive" answer; null for every other error. */
export function portalNotSetUp(error: DashError): PortalNotSetUp | null {
  // the client reports the server's own code as `code` when the dashboards know it, else as `details.serverCode` beside a plain CONFLICT
  const code = error.code === 'PORTAL_NOT_LINKED' || error.code === 'PORTAL_INACTIVE' ? error.code : error.details?.serverCode;
  if (code !== 'PORTAL_NOT_LINKED' && code !== 'PORTAL_INACTIVE') return null;
  const p = error.details?.fields?.portal;
  const portal: PortalKind | null = p === 'guest' || p === 'company' ? p : null;
  const inactive = code === 'PORTAL_INACTIVE';
  const own = error.message?.trim();
  return { portal, inactive, message: own && own !== code && own !== error.code ? own : inactive ? portalCopy.fallback.inactive : portalCopy.fallback[portal ?? 'guest'] };
}
