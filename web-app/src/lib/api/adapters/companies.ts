// Companies (profiles, ledger, customers, CRM) over the real server: /api/v1/companies/... (docs/api/companies.md).
// The server decides who is working from the session, so `setActor` does nothing here.
import type { CompaniesApi } from '@shared/dashboards/companies';

import * as api from '../client';
import { getEveryPage, lookupLimit, pick } from './payrollShared';

const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const id = encodeURIComponent;
/** A paged list: the screens ask for one big page (1000, 5000) and the server's largest is 100, so getEveryPage joins pages of 100 (payrollShared). */
const every = <T>(path: string, q: { search?: string; page?: number; pageSize?: number } | undefined, more: Record<string, string | number | boolean | undefined> = {}) =>
  getEveryPage<T>(path, { search: q?.search?.trim(), ...more }, q?.pageSize, q?.page);

const COMPANY_KEYS = ['name', 'gstNumber', 'mobile', 'phone', 'email', 'address', 'country', 'pincode', 'nationality', 'discountPct', 'gstPct', 'tcsPct', 'tdsPct', 'instruction', 'contacts'] as const;
const CUSTOMER_KEYS = ['name', 'mobile', 'email', 'address', 'city', 'idProofType', 'idProofNumber', 'notes', 'isActive'] as const;
const CAMPAIGN_KEYS = ['subject', 'body', 'audience'] as const;
const CONTACT_KEYS = ['role', 'name', 'email', 'mobile'] as const;

type CompanyInput = Parameters<CompaniesApi['createCompany']>[0];
const companyBody = (i: CompanyInput) => ({ ...pick(i, COMPANY_KEYS), contacts: i.contacts.map((c) => pick(c, CONTACT_KEYS)) });

export function createCompaniesRealApi(): CompaniesApi {
  return {
    setActor: () => undefined,

    getOptions: () => api.get('/companies/options'),

    // profiles
    lookupCompanies: (q) => api.get('/companies/lookup', { q: q?.q, limit: lookupLimit(q?.limit) }),
    listCompanies: (q) => every('/companies', q),
    getCompany: (cid) => api.get(`/companies/${id(cid)}`),
    createCompany: (input) => api.post('/companies', companyBody(input)),
    updateCompany: (cid, input) => api.patch(`/companies/${id(cid)}`, companyBody(input)),
    deleteCompany: (cid) => api.del(`/companies/${id(cid)}`),

    // ledger
    ledgerOverview: (q) => every('/companies/ledger', q, { show: oneOf(q?.tab, ['all', 'owing', 'credit', 'settled']) }),
    ledgerStatement: (cid, q) =>
      every(`/companies/${id(cid)}/ledger`, q, { period: q?.period, from: q?.from, to: q?.to }),
    ledgerAgeing: () => api.get('/companies/ledger/ageing'),
    companyStatement: (cid, q) => api.get(`/companies/${id(cid)}/statement`, { from: q.from, to: q.to }),

    // customers
    listCustomers: (q) => every('/companies/customers', q, { tab: oneOf(q?.tab, ['all', 'active', 'off']) }),
    getCustomer: (cid) => api.get(`/companies/customers/${id(cid)}`),
    createCustomer: (input) => api.post('/companies/customers', pick(input, CUSTOMER_KEYS)),
    updateCustomer: (cid, input) => api.patch(`/companies/customers/${id(cid)}`, pick(input, CUSTOMER_KEYS)),
    deleteCustomer: (cid) => api.del(`/companies/customers/${id(cid)}`),
    revealCustomerIdNumber: (cid) => api.post(`/companies/customers/${id(cid)}/id-number`),
    resetCustomerLogin: (cid) => api.post(`/companies/customers/${id(cid)}/reset-login`),
    lookupCustomers: (q) => api.get('/companies/customers/lookup', { q: q?.q, limit: lookupLimit(q?.limit) }),

    // email marketing
    marketing: () => api.get('/companies/marketing'),
    createCampaign: (input) => api.post('/companies/marketing/campaigns', pick(input, CAMPAIGN_KEYS)),
    updateCampaign: (cid, input) => api.patch(`/companies/marketing/campaigns/${id(cid)}`, pick(input, CAMPAIGN_KEYS)),
    deleteCampaign: (cid) => api.del(`/companies/marketing/campaigns/${id(cid)}`),
    estimateCampaign: (cid) => api.get(`/companies/marketing/campaigns/${id(cid)}/estimate`),
    sendCampaign: (cid, expected) => api.post(`/companies/marketing/campaigns/${id(cid)}/send`, { expected }),
    pauseCampaign: (cid) => api.post(`/companies/marketing/campaigns/${id(cid)}/pause`),
    resumeCampaign: (cid) => api.post(`/companies/marketing/campaigns/${id(cid)}/resume`),
    cancelCampaign: (cid) => api.post(`/companies/marketing/campaigns/${id(cid)}/cancel`),
    testCampaign: (cid) => api.post(`/companies/marketing/campaigns/${id(cid)}/test`),
  };
}
