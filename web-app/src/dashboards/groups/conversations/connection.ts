// Pure helper of the Email and WhatsApp pages (MJ, 1 Nov 2026): where a channel stands (connected or not) as one small pill and one plain sentence, from the answer of the list
// (MailboxState, WhatsAppChannelState). Kept apart so a test can run it without a browser.
import type { MailboxState, WhatsAppChannelState } from '@shared/dashboards/conversations';

export type ConnectionTone = 'ok' | 'warn' | 'bad' | 'off';
export interface Connection {
  tone: ConnectionTone;
  /** The word in the pill. */
  label: string;
  /** What it means and what to do, in plain words. */
  message: string;
}

export function emailConnection(m: MailboxState | undefined): Connection {
  if (!m) return { tone: 'off', label: 'Checking', message: 'Checking the mailbox.' };
  const who = m.address ? ` ${m.address}` : '';
  if (m.state === 'ok') return { tone: 'ok', label: 'Connected', message: `Connected.${who ? ` New mail for${who} arrives here within a minute.` : ' New mail arrives here within a minute.'}` };
  if (m.state === 'checking') return { tone: 'off', label: 'Checking', message: 'Checking the mailbox. This takes a few seconds.' };
  if (m.state === 'error') return { tone: 'bad', label: 'Problem', message: `The mailbox could not be read${m.message ? `: ${m.message}` : ''}. Mail you send still goes out. Ask the platform administrator to check the login under Hotel and group mail.` };
  if (m.reason === 'password_unreadable' || m.reason === 'needs_update') return { tone: 'warn', label: 'Needs attention', message: 'The saved password cannot be opened. The platform administrator needs to type it again under Hotel and group mail.' };
  // no Google inbox, but mail to the hotel's (or group's) own address arrives through Amazon SES receiving and is answered from it
  if (m.receivingAddress) return { tone: 'ok', label: 'Connected', message: `Connected. Mail to ${m.receivingAddress} arrives here through Amazon SES, and your replies go out from that address.` };
  if (m.reason === 'send_only' || m.reason === 'platform_mail') return { tone: 'warn', label: 'Sending only', message: 'Mail goes out through Amazon SES, so replies are not read here. The platform administrator can connect a Google inbox under Hotel and group mail.' };
  return { tone: 'off', label: 'Not connected', message: 'No mailbox is connected yet. The platform administrator connects the hotel\'s Google account under Hotel and group mail.' };
}

export function whatsappConnection(w: WhatsAppChannelState | undefined): Connection {
  if (!w) return { tone: 'off', label: 'Checking', message: 'Checking WhatsApp.' };
  if (w.connected) return { tone: 'ok', label: 'Connected', message: `Connected${w.number ? ` on ${w.number}` : ''}. Guest messages arrive here within a minute.` };
  if (w.available) return { tone: 'off', label: 'Not connected', message: 'WhatsApp is not connected for this hotel yet. The Hotel Admin connects it under Settings, WhatsApp.' };
  return { tone: 'off', label: 'Not available', message: 'WhatsApp is not switched on for this hotel yet. Ask the platform administrator.' };
}
