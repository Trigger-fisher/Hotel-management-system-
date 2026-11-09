'use client';

// Which way a message came: an envelope for email, the WhatsApp mark for WhatsApp. Named for a screen reader ("Email", "WhatsApp") unless it only
// decorates a label that already says it (`decorative`).
//   <ChannelIcon channel="whatsapp" />
import { conversationsCopy, type ConvChannel } from '@shared/dashboards/conversations';

import { Bi } from '../Bi';

const ICON: Record<ConvChannel, string> = { email: 'envelope', whatsapp: 'whatsapp' };

export function ChannelIcon({ channel, decorative = false, className = '' }: { channel: ConvChannel; decorative?: boolean; className?: string }) {
  const label = conversationsCopy.channels[channel];
  if (decorative) return <Bi name={ICON[channel]} className={`cv-ch cv-ch-${channel} ${className}`.trim()} />;
  return (
    <span className={`cv-ch cv-ch-${channel} ${className}`.trim()} role="img" aria-label={label} title={label}>
      <Bi name={ICON[channel]} />
    </span>
  );
}
