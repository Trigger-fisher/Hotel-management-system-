// The chat button at the bottom right (MJ, 1 Nov 2026): shown to a Hotel user, a Guest user and a Corporate user only. Platform and Group consoles, the sign-in page
// and a hotel entered read-only never get it. Each role has its own greeting, four topics and the person it hands over to. Every answer is a how-to that points at
// a real menu page; nothing here reads or changes hotel data. Chat with a person is not connected yet, so that button says so and gives the way to reach them.
import type { DashboardKind } from './nav';

export type ChatKind = 'hotel' | 'guest' | 'corporate';

export interface ChatTopic {
  id: string;
  label: string;
  answer: string;
}

export interface ChatConfig {
  title: string;
  status: string;
  hello: string;
  topics: ChatTopic[];
  person: string;
  personNote: string;
}

export const supportChatCopy = {
  open: 'Open the chat',
  close: 'Close the chat',
  /** The avatar menu's entry on a phone, where the round button is not drawn. */
  menu: 'Help',
  today: 'Today',
  pick: 'Pick one, or type below.',
  placeholder: 'Ask anything',
  send: 'Send',
  hint: 'Enter sends. Shift and Enter adds a line.',
  unknown: 'I can only help with the topics below for now. Pick one, or use the person button.',
  typing: 'The assistant is typing',
} as const;

const config: Record<ChatKind, ChatConfig> = {
  hotel: {
    title: 'HMS Assistant',
    status: 'For hotel staff',
    hello: 'Hello! I can show you where things are in HMS and how to do them.',
    topics: [
      { id: 'rooms', label: 'Rooms free tonight', answer: 'Open Room board under Front desk. It shows every room and its state.' },
      { id: 'arrivals', label: "Today's arrivals", answer: "Open Reservations under Front desk and filter by today's date. Check in from there." },
      { id: 'bills', label: 'Pending bills', answer: 'Open In-house guests under Front desk. Open a guest to see the bill.' },
      { id: 'checkin', label: 'How do I check someone in?', answer: 'Open Reservations, find the booking and use Check in. For a guest with no booking, use the Walk-in check-in button on the same page.' },
    ],
    person: 'Talk to a person',
    personNote: 'Chat with a person is not connected yet. Please contact HMS support directly.',
  },
  guest: {
    title: 'Guest Assistant',
    status: 'For your stay',
    hello: 'Welcome! I can help with your stay: where to find your bill, how to order food and how to reach the front desk.',
    topics: [
      { id: 'stay', label: 'My booking details', answer: 'Open Home. Your stay details are there.' },
      { id: 'order', label: 'Order food to my room', answer: 'Open Room service, pick your items and place the order.' },
      { id: 'bill', label: 'See my bill', answer: 'Open Bills to see what you owe, and Payments to see what you have already paid.' },
      { id: 'late', label: 'Ask for late check-out', answer: 'Please ask the front desk. Late check-out depends on the next booking for your room.' },
    ],
    person: 'Talk to the front desk',
    personNote: 'Chat with the front desk is not connected yet. Please call the front desk from your room phone.',
  },
  corporate: {
    title: 'Corporate Assistant',
    status: 'For your company account',
    hello: "Hello! I can help with your company's bills, payments and statement.",
    topics: [
      { id: 'bills', label: 'Find a bill', answer: 'Open Bills under Accounts. Every bill raised for your company is listed there.' },
      { id: 'payments', label: 'See our payments', answer: 'Open Payments under Accounts to see every payment received from your company.' },
      { id: 'statement', label: 'Open the statement', answer: 'Open Statement under Accounts. It lists the bills and payments of your company.' },
      { id: 'company', label: 'Update company details', answer: 'Open Company to see your company details. To change them, ask your account manager.' },
    ],
    person: 'Talk to my account manager',
    personNote: 'Chat with your account manager is not connected yet. Please call or email them directly.',
  },
};

/** The chat for this dashboard, or null when the dashboard gets no chat button. `inside` is a hotel entered read-only by platform or group staff. */
export function supportChatFor(kind: DashboardKind, inside: boolean): ChatConfig | null {
  if (inside) return null;
  return kind === 'hotel' || kind === 'guest' || kind === 'corporate' ? config[kind] : null;
}
