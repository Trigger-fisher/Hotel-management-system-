'use client';

// platform.vault: My vault, the signed-in Super Admin's own items (platform 0190). A hotel's vault opens only on the hotel's page: an old link with params.hotel opens that page on
// its Vault tab.
import { useEffect } from 'react';

import { PERSONAL_VAULT_KINDS, personalVaultCopy as P } from '@shared/dashboards/personalVault';

import type { ScreenProps } from '../../types';
import { PageHead } from '@/dashboards/pallav/ui';
import { Wait } from '../payrollCore/load';
import { VaultPanel } from './HotelVault';
import { personalVaultApi } from './personalVaultApi';
import { SuperOnly } from './superParts';

export function PlatformVault(props: ScreenProps) {
  const { user, params, navigate } = props;
  const hotel = params.hotel ?? '';
  useEffect(() => {
    if (hotel) navigate('platform.hotel', { id: hotel, tab: 'vault' });
  }, [hotel, navigate]);
  if (hotel) return <Wait error={null} onRetry={() => undefined} tiles={false} rows={4} />;
  if (user.role !== 'super_admin') return <SuperOnly />;
  return (
    <>
      <PageHead className="reveal" sub={P.sub} />
      <VaultPanel api={personalVaultApi} copy={P} kinds={PERSONAL_VAULT_KINDS} expiryKinds={['card', 'id_document']} scope={user.id} />
    </>
  );
}
