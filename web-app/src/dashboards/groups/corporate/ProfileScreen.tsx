'use client';

// corporate.profile, "Company": the company's record. What the company keeps (its details, the people to contact) is separated from what the hotel sets
// (discount, GST, TCS, TDS: read only). With the one common profile the details are the same at every hotel and the terms are the chosen hotel's;
// otherwise the record is the side menu's hotel (the first one with "All hotels"). One Save at the foot, sticky on a phone, with an unsaved-changes line.
import { useState } from 'react';

import { formatPct, type PortalContact, type PortalProfile, type PortalProfileInput } from '@shared/dashboards/corporate';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';
import { lastChangeLine } from '@shared/dashboards/profileReview';

import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, DetailList, DetailNone, Field, FormSection, IconButton, TextAction } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import { usePortalHotel } from '../portal/HotelSwitch';
import { corporateApi } from './api';
import { PortalLoad } from './AccountList';
import { cpWords } from './words';

const FIELDS = ['mainContactName', 'email', 'mobile', 'landline', 'pincode', 'country', 'gstin'] as const;
type TextField = (typeof FIELDS)[number];
const W = cpWords.profile;

interface Draft {
  mainContactName: string;
  email: string;
  mobile: string;
  landline: string;
  address: string;
  pincode: string;
  country: string;
  gstin: string;
  contacts: PortalContact[];
}

const draftOf = (p: PortalProfile): Draft => ({
  mainContactName: p.mainContactName ?? '',
  email: p.email,
  mobile: p.mobile,
  landline: p.landline ?? '',
  address: p.address,
  pincode: p.pincode,
  country: p.country,
  gstin: p.gstin,
  contacts: p.contacts.map((x) => ({ ...x })),
});

export function CorporateProfileScreen() {
  const T = useCopy(corporateCopyByLanguage).portalProfile;
  const choice = usePortalHotel();
  const hotels = useAsync(() => corporateApi.listHotels(), []);
  const list = hotels.state.status === 'ready' ? hotels.state.data : [];
  const hotelId = choice !== PORTAL_ALL_HOTELS ? choice : list[0]?.hotelId || '';
  const hotelName = list.find((h) => h.hotelId === hotelId)?.name ?? '';
  const profile = useAsync(() => (hotelId ? corporateApi.getPortalProfile(hotelId) : corporateApi.getPortalProfile()), [hotelId]);
  const several = choice === PORTAL_ALL_HOTELS && list.length > 1 && Boolean(hotelName);

  return (
    <PortalLoad state={profile.state} onRetry={profile.reload}>
      {(p: PortalProfile) => (
        <ProfileForm key={`${p.hotelId}:${p.id}`} p={p} common={p.common === true} note={several ? T.shownFor(hotelName, p.common === true) : null} />
      )}
    </PortalLoad>
  );
}

function ProfileForm({ p, common, note }: { p: PortalProfile; common: boolean; note: string | null }) {
  const T = useCopy(corporateCopyByLanguage).portalProfile;
  const toast = useToast();
  const [saved, setSaved] = useState(p);
  const [v, setV] = useState<Draft>(() => draftOf(p));
  const { busy, errors, submit } = useSubmit([...FIELDS, 'address', 'contacts']);
  const last = common && saved.lastChange ? lastChangeLine(saved.lastChange) : null;
  const dirty = JSON.stringify(v) !== JSON.stringify(draftOf(saved));

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setV((d) => ({ ...d, [key]: value }));
  const text = (key: TextField, label: string, col = 'col-md-6') => (
    <Field label={label} col={col} error={errors[key]}>
      <input className={`form-control${errors[key] ? ' is-invalid' : ''}`} value={v[key]} onChange={(e) => set(key, e.target.value)} maxLength={150} />
    </Field>
  );
  const setContact = (i: number, key: keyof PortalContact, value: string) => set('contacts', v.contacts.map((x, n) => (n === i ? { ...x, [key]: value } : x)));

  const onSubmit = () => {
    const input: PortalProfileInput = {
      mainContactName: v.mainContactName,
      email: v.email,
      mobile: v.mobile,
      landline: v.landline,
      address: v.address,
      pincode: v.pincode,
      country: v.country,
      gstin: v.gstin,
      contacts: v.contacts.filter((x) => x.name.trim() || x.email.trim() || x.mobile.trim()),
    };
    void submit(
      () => corporateApi.savePortalProfile(p.hotelId, input),
      (next) => {
        setSaved(next);
        setV(draftOf(next));
        toast.show({ tone: 'success', text: T.saved });
      },
    );
  };

  return (
    <form
      className="cp-page"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="page-head">
        <div>
          <h2 className="pms-title">{saved.name}</h2>
          <p className="pms-sub">{[common ? tr(W.sameEverywhere) : saved.hotelName, last].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {note ? (
        <p className="cp-note">
          <Bi name="info-circle" /> {note}
        </p>
      ) : null}

      <div className="cp-prof-grid">
        <section className="card cp-info cp-prof-main" aria-label={W.details}>
          <FormSection icon="building" title={W.details} hint={common ? 'Change these and save. A change here shows at every hotel.' : W.detailsNote}>
            <div className="row g-3">
              {text('mainContactName', T.fields.mainContactName)}
              {text('email', T.fields.email)}
              {text('mobile', T.fields.mobile)}
              {text('landline', T.fields.landline)}
              <Field label={T.fields.address} col="col-12" error={errors.address}>
                <input className={`form-control${errors.address ? ' is-invalid' : ''}`} value={v.address} onChange={(e) => set('address', e.target.value)} maxLength={300} />
              </Field>
              {text('pincode', T.fields.pincode, 'col-md-4')}
              {text('country', T.fields.country, 'col-md-4')}
              {text('gstin', T.fields.gstin, 'col-md-4')}
            </div>
          </FormSection>
        </section>

        <section className="card cp-info cp-prof-terms" aria-label={W.terms}>
          <FormSection icon="percent" title={W.terms} hint={common ? W.termsAt(saved.hotelName) : W.termsNote}>
            <DetailList items={(['discountPct', 'gstPct', 'tcsPct', 'tdsPct'] as const).map((k) => ({ label: T.pricing[k], value: formatPct(saved.pricing[k]) ?? T.none }))} />
          </FormSection>
        </section>

        <section className="card cp-info cp-prof-people" aria-label={W.people}>
          <FormSection
            icon="people"
            title={W.people}
            hint={W.peopleNote}
            aside={
              v.contacts.length < 20 ? (
                <TextAction kind="add" onClick={() => set('contacts', [...v.contacts, { name: '', role: '', email: '', mobile: '' }])}>
                  {T.addContact}
                </TextAction>
              ) : undefined
            }
          >
            {v.contacts.length === 0 ? (
              <DetailNone>{W.noPeople}</DetailNone>
            ) : (
              <div className="cp-people">
                {v.contacts.map((x, i) => (
                  <div key={i} className="cp-person">
                    <div className="cp-person-h">
                      <b>{x.name.trim() || tr(W.person(i + 1))}</b>
                      <IconButton icon="trash" tone="danger" label={tr(T.removeContact)} onClick={() => set('contacts', v.contacts.filter((_, n) => n !== i))} />
                    </div>
                    <div className="row g-2">
                      <Field label={T.contact.name} col="col-sm-6">
                        <input className="form-control" value={x.name} onChange={(e) => setContact(i, 'name', e.target.value)} maxLength={150} />
                      </Field>
                      <Field label={T.contact.role} col="col-sm-6">
                        <input className="form-control" value={x.role} onChange={(e) => setContact(i, 'role', e.target.value)} maxLength={150} />
                      </Field>
                      <Field label={T.contact.email} col="col-sm-6">
                        <input className="form-control" type="email" value={x.email} onChange={(e) => setContact(i, 'email', e.target.value)} maxLength={150} />
                      </Field>
                      <Field label={T.contact.mobile} col="col-sm-6">
                        <input className="form-control" inputMode="tel" value={x.mobile} onChange={(e) => setContact(i, 'mobile', e.target.value)} maxLength={20} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        </section>
      </div>

      <div className="pt-m-savebar cp-savebar">
        {dirty ? (
          <span className="cp-unsaved" role="status">
            <Bi name="pencil" /> {tr(W.unsaved)}
          </span>
        ) : null}
        <Button type="submit" icon="check2" busy={busy} busyLabel={T.saving} disabled={!dirty}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}
