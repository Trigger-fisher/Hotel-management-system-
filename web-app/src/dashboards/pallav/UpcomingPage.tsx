'use client';
// A placeholder page for a feature the product document labels Upcoming (BR-12: such features stay labelled Upcoming until they are delivered and tested).
import type { ComponentType } from 'react';

import type { ScreenProps } from '../types';
import { EmptyState } from './ui';

import { trf } from '@/lib/i18n/language';
/** One screen per Upcoming feature: the page says plainly that it is not available yet. */
export function upcomingPage(title: string, icon: string, why: string): ComponentType<ScreenProps> {
  return function UpcomingPage() {
    return (
      <div className="card">
        <EmptyState icon={icon} title={trf("{0} (Upcoming)", [title])} text={`${why} It is planned and not available yet.`} />
      </div>
    );
  };
}
