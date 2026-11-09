'use client';

// Hotel and group mail > Replies coming in: the address the Super Admin adds to the SNS topic that SES publishes to (protocol HTTPS). It holds a secret key: shown only here.
import { useState } from 'react';

import { platformCopy } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { Alert, Button, FormSection } from '@/dashboards/pallav/ui';
import { Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { actAs } from './PlatformStaff';

const M = platformCopy.hotelMailPage.inbound;

export function InboundMailCard({ user }: { user: ScreenProps['user'] }) {
  const { data, error, reload } = useLoaded(() => {
    actAs(user);
    return platformApi.getInboundMail();
  }, []);
  const [copied, setCopied] = useState(false);
  if (!data) return <Wait error={error} onRetry={reload} tiles={false} rows={2} />;
  const copy = () => {
    if (!data.address) return;
    void navigator.clipboard?.writeText(data.address).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="pf-detail-grid reveal">
      <div className="card p-3 p-md-4">
        <FormSection icon="inbox" title={M.title} hint={M.hint}>
          {data.address ? (
            <div className="pf-copy">
              {/* check-shared-ignore: a read-only box that shows the address to copy */}
              <input className="form-control pf-mono" readOnly value={data.address} aria-label={M.addressLabel} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" icon={copied ? 'check2' : 'clipboard'} onClick={copy}>
                {copied ? M.copied : M.copy}
              </Button>
            </div>
          ) : (
            <Alert tone="warning" icon="exclamation-triangle">
              {M.noAddress}
            </Alert>
          )}
          {!data.topicSet ? (
            <Alert tone="warning" icon="exclamation-triangle" className="mt-3 mb-0">
              {M.noTopic}
            </Alert>
          ) : null}
        </FormSection>
      </div>
      <div className="card p-3 p-md-4">
        <FormSection icon="signpost-split" title={M.stepsTitle}>
          <ol className="pf-steps">
            {M.steps.map((s, i) => (
              <li key={s}>
                <span className="pf-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </FormSection>
      </div>
    </div>
  );
}
