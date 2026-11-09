'use client';

// group.profile: My Profile of the Group Hotel Admin. The shared My Profile screen (details, password, emailed code, sign-in history) for the
// person, then the group they run as its own read-only card.
import { useMemo } from 'react';

import { formatDate } from '@shared/dashboards/format';
import { groupConsoleCopy } from '@shared/dashboards/groupConsole';
import { groupCopy } from '@shared/dashboards/groupCopy';

import type { ScreenProps } from '../../types';
import { Button, DetailList, FormSection } from '@/dashboards/pallav/ui';
import { Profile } from '../admin/Profile';
import { useLoaded } from '../payrollCore/load';
import { groupApiFor } from './api';

const P = groupCopy.profile;

export function GroupProfile(props: ScreenProps) {
  const api = useMemo(() => groupApiFor(props.user), [props.user]);
  const { data } = useLoaded(() => api.groupOverview(), [api]);
  const g = data?.group;
  return (
    <>
      <Profile {...props} />
      {g && data ? (
        <div className="card p-3 p-md-4 reveal gc-group-card">
          <FormSection
            icon="buildings"
            title={P.groupTitle}
            hint={P.groupHint}
            aside={
              <Button variant="outline" size="sm" icon="building" onClick={() => props.navigate('group.hotels')}>
                {P.openHotels}
              </Button>
            }
          >
            <DetailList
              items={[
                { label: P.name, value: g.name },
                { label: P.legalName, value: g.legalName || P.notGiven },
                { label: P.role, value: g.isPrimaryAdmin ? P.primary : P.secondary },
                { label: P.hotels, value: groupConsoleCopy.groupHotel.count(data.tiles.hotelsCounted, g.maxHotels, data.tiles.invitationsOpen) },
                { label: P.gstin, value: g.gstin || P.notGiven },
                { label: P.city, value: [g.city, g.state].filter(Boolean).join(', ') || P.notGiven },
                { label: P.email, value: g.email || P.notGiven },
                { label: P.phone, value: g.phone || P.notGiven },
                { label: P.since, value: formatDate(g.createdAt) },
              ]}
            />
          </FormSection>
        </div>
      ) : null}
    </>
  );
}
