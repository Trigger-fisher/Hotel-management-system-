// Payroll (core half) over the real server: /api/v1/payroll/companies/{cid}/... (docs/api/payroll-core.md).
// The server was built to this contract, so shapes pass straight through; only the query and body keys are narrowed to what the strict routes accept.
import type { PayrollCoreApi } from '@shared/dashboards/payrollCore';

import * as api from '../client';
import { deletedFlag, getEveryPage, lookupLimit, pick } from './payrollShared';

const TABS = new Set(['all', 'active', 'inactive']);
const co = (companyId: string) => `/payroll/companies/${companyId}`;

const EMPLOYEE_KEYS = [
  'name', 'dateOfBirth', 'gender', 'contactNumber', 'contactCountry', 'email', 'address', 'nationality', 'countryAndPincode', 'emergencyContactName',
  'emergencyContactRelation', 'emergencyContactNumber', 'emergencyContactCountry', 'employeeCode', 'designation', 'department', 'shift', 'joiningDate',
  'dailyWorkingHours', 'qualification', 'qualificationInstitution', 'skills', 'responsibilities', 'salaryPaise', 'paymentMode', 'bankName',
  'accountHolderName', 'accountNumber', 'ifscCode', 'branchName', 'idProofType', 'idProofNumber', 'sendOfferLetter',
] as const;

type EmployeeInput = Parameters<PayrollCoreApi['createEmployee']>[1];
function employeeBody(input: EmployeeInput) {
  return {
    ...pick(input, EMPLOYEE_KEYS),
    deductions: input.deductions.map((d) => ({ ...(d.id ? { id: d.id } : {}), deductionId: d.deductionId, type: d.type, amountPaise: d.amountPaise })),
  };
}

const COMPANY_KEYS = [
  'ownerName', 'mobileNumber', 'email', 'address', 'city', 'state', 'pincode', 'panNumber', 'tanNumber', 'pfRegistrationNumber', 'esicRegistrationNumber',
  'professionalTaxRegistrationNumber', 'authorizedPersonName', 'authorizedDesignation', 'authorizedMobile', 'authorizedEmail', 'bankName', 'branchName',
  'accountNumber', 'ifscCode',
] as const;

const STATUS_KEYS = ['name', 'shortcutKey', 'color', 'attendancePercentage', 'statusType', 'skipsFood', 'isActive'] as const;

export function createPayrollCoreRealApi(): PayrollCoreApi {
  return {
    listCompanies: () => api.get('/payroll/companies'),
    getCompany: (cid) => api.get(co(cid)),
    updateCompany: (cid, input) => api.patch(co(cid), pick(input, COMPANY_KEYS)),
    getDashboard: (cid) => api.get(`${co(cid)}/dashboard`),
    getOptions: (cid) => api.get(`${co(cid)}/options`),

    listEmployees: (cid, q) =>
      getEveryPage(`${co(cid)}/employees`, { search: q?.search?.trim(), tab: q?.tab && TABS.has(q.tab) ? q.tab : undefined, deleted: deletedFlag(q?.deleted) }, q?.pageSize, q?.page),
    lookupEmployees: (cid, q) => api.get(`${co(cid)}/employees/lookup`, { q: q?.q, limit: lookupLimit(q?.limit) }),
    getEmployee: (cid, id) => api.get(`${co(cid)}/employees/${id}`),
    createEmployee: (cid, input) => api.post(`${co(cid)}/employees`, employeeBody(input)),
    updateEmployee: (cid, id, input) => api.patch(`${co(cid)}/employees/${id}`, employeeBody(input)),
    deleteEmployee: (cid, id) => api.del(`${co(cid)}/employees/${id}`),
    restoreEmployee: (cid, id) => api.post(`${co(cid)}/employees/${id}/restore`),
    purgeEmployee: (cid, id) => api.del(`${co(cid)}/employees/${id}/purge`),
    toggleEmployee: (cid, id) => api.post(`${co(cid)}/employees/${id}/toggle`),
    sendOfferLetter: (cid, id) => api.post(`${co(cid)}/employees/${id}/offer-letter`),

    getAttendance: (cid, month, q) => api.get(`${co(cid)}/attendance/${month}`, { page: q?.page, pageSize: q?.pageSize }),
    saveAttendance: (cid, month, rows, q) =>
      api.put(
        `${co(cid)}/attendance/${month}`,
        { rows: rows.map((r) => ({ employeeId: r.employeeId, days: r.days, ...(r.overtime ? { overtime: r.overtime } : {}) })) },
        { query: { page: q?.page, pageSize: q?.pageSize } },
      ),
    generateSalary: (cid, month) => api.post(`${co(cid)}/attendance/${month}/generate`),
    regenerateSalary: (cid, month) => api.post(`${co(cid)}/attendance/${month}/regenerate`),
    unlockAttendance: (cid, month) => api.post(`${co(cid)}/attendance/${month}/unlock`),

    listStatuses: (cid) => api.get(`${co(cid)}/attendance-statuses`),
    createStatus: (cid, input) => api.post(`${co(cid)}/attendance-statuses`, pick(input, STATUS_KEYS)),
    updateStatus: (cid, id, input) => api.patch(`${co(cid)}/attendance-statuses/${id}`, pick(input, STATUS_KEYS)),
    deleteStatus: (cid, id) => api.del(`${co(cid)}/attendance-statuses/${id}`),
    toggleStatus: (cid, id) => api.post(`${co(cid)}/attendance-statuses/${id}/toggle`),

    listDeductions: (cid) => api.get(`${co(cid)}/deductions`),
    createDeduction: (cid, input) => api.post(`${co(cid)}/deductions`, pick(input, ['name', 'standardAmountPaise', 'isActive'] as const)),
    updateDeduction: (cid, id, input) => api.patch(`${co(cid)}/deductions/${id}`, pick(input, ['name', 'standardAmountPaise', 'isActive'] as const)),
    deleteDeduction: (cid, id) => api.del(`${co(cid)}/deductions/${id}`),
    toggleDeduction: (cid, id) => api.post(`${co(cid)}/deductions/${id}/toggle`),

    listStaffEmails: (cid, q) =>
      getEveryPage(`${co(cid)}/staff-emails`, { search: q?.search?.trim(), status: q?.status, from: q?.from, to: q?.to }, q?.pageSize, q?.page),
    // polled every 4 s while an email is being sent: never the 20 s memory of GET answers
    staffEmailFeed: (cid, q) => api.get(`${co(cid)}/staff-emails/feed`, { after: q.after, watch: q.watch.join(',') }, undefined, { fresh: true }),
    listRecipients: (cid) => api.get(`${co(cid)}/staff-emails/recipients`),
    sendStaffEmails: (cid, employeeIds, recipientId) => api.post(`${co(cid)}/staff-emails`, { recipientId, employeeIds }),
  };
}
