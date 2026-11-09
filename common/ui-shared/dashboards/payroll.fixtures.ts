// Hotel Pallav's own scratch demo rows (docs/sessions/S08-fixtures) turned into the two payroll mocks' stores (core + pay), so Payroll can be compared
// with Pallav on the same data. Only used when the dev preview asks for it (`?data=s08`). Both mocks get the SAME ids: a company or an employee is its
// Pallav id as a string ("1", "7"), so the company switcher and the employee pickers agree between the two halves.
// Dates stay exactly as Pallav stores them; the fixtures were exported on 2026-10-05, a month before the payroll mocks' own "today" (2026-11-05).
// Encrypted values (account numbers, IFSC, ID numbers: Laravel ciphertext "eyJpdiI6...") cannot be read, so they come through as empty.
import {
  formatPhone,
  type AttendanceLock, type AttendancePercentage, type AttendanceStatus, type Deduction, type DeductionType, type Employee, type MonthRecord,
  type PayrollCompany, type PayrollCoreSeed, type StatusType,
} from './payrollCore';
import {
  paymentStatuses,
  type Advance, type LetterKind, type LetterTemplate, type LogAction, type LogStatus, type MasterItem, type MasterListKey, type PayEmployee, type PayrollCompanyRef,
  type PayrollLogEntry, type PayrollPaySeed, type SalaryLine, type SalaryLineCategory, type SalaryRecord, type SeparationSeed, type SeparationStatus,
  type PaymentStatus,
} from './payrollPay';

type Row = Record<string, unknown>;

export interface PayrollFixtures {
  companies: Row[];
  employees: Row[];
  deductions: Row[];
  employeeDeductions: Row[];
  attendanceStatuses: Row[];
  attendanceMonths: Row[];
  attendanceEntries: Row[];
  separations: Row[];
  masterItems: Row[];
  salaryProcessings: Row[];
  salaryProcessingLines: Row[];
  advances: Row[];
  bonuses: Row[];
  mealPeriods: Row[];
  foodRates: Row[];
  joiningLetters: Row[];
  experienceLetters: Row[];
  logs: Row[];
}

export interface PayrollSeeds {
  core: PayrollCoreSeed;
  pay: PayrollPaySeed;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const paise = (v: unknown): number => Math.round(num(v) * 100);
const id = (v: unknown): string => String(num(v));
const day = (v: unknown): string => str(v).slice(0, 10);
/** "2026-10-05 18:52:24" (Pallav stores IST) -> ISO instant. */
const stamp = (v: unknown): string => {
  const t = str(v);
  return t ? new Date(`${t.slice(0, 10)}T${t.slice(11, 19) || '00:00:00'}+05:30`).toISOString() : '';
};
/** Laravel ciphertext is unreadable here: show nothing rather than gibberish. */
const plain = (v: unknown): string => (str(v).startsWith('eyJpdiI6') ? '' : str(v));
const live = (r: Row): boolean => !r.deleted_at;

export function payrollSeedFromFixtures(f: PayrollFixtures): PayrollSeeds {
  // ---- companies
  const coreCompanies: PayrollCompany[] = f.companies.map((c) => ({
    id: id(c.id), name: str(c.name), code: str(c.code), ownerName: str(c.owner_name), mobileNumber: str(c.mobile_number), email: str(c.email),
    address: str(c.address), city: str(c.city), state: str(c.state), pincode: str(c.pincode), panNumber: str(c.pan_number), tanNumber: str(c.tan_number),
    pfRegistrationNumber: str(c.pf_registration_number), esicRegistrationNumber: str(c.esic_registration_number),
    professionalTaxRegistrationNumber: str(c.professional_tax_registration_number), authorizedPersonName: str(c.authorized_person_name),
    authorizedDesignation: str(c.authorized_designation), authorizedMobile: str(c.authorized_mobile), authorizedEmail: str(c.authorized_email),
    bankName: str(c.bank_name), branchName: str(c.branch_name), accountNumber: plain(c.account_number) || null, ifscCode: plain(c.ifsc_code),
    isActive: num(c.is_active) === 1,
  }));
  const payCompanies: PayrollCompanyRef[] = f.companies.map((c) => ({
    id: id(c.id), name: str(c.name), code: str(c.code), providesFood: /food/i.test(str(c.name)),
    address: [str(c.address), str(c.city), str(c.state), str(c.pincode)].filter(Boolean).join(', '), gstin: '',
  }));

  // ---- master lists (shared lists when payroll_company_id is null)
  const masterList = (key: string): string[] => f.masterItems.filter((m) => m.list === key && num(m.is_active) === 1).sort((a, b) => num(a.sort_order) - num(b.sort_order)).map((m) => str(m.label));
  const master: MasterItem[] = f.masterItems.map((m) => ({
    id: `mi${id(m.id)}`, list: str(m.list) as MasterListKey, scope: m.payroll_company_id === null || m.payroll_company_id === undefined ? 'all' : id(m.payroll_company_id),
    label: str(m.label), value: m.value === null || m.value === undefined ? null : str(m.value), isActive: num(m.is_active) === 1, sortOrder: num(m.sort_order),
  }));

  // ---- employees
  const deductionRows = new Map<string, Employee['deductions']>();
  for (const d of f.employeeDeductions) {
    const key = id(d.employee_id);
    const list = deductionRows.get(key) ?? [];
    list.push({ id: `ed${id(d.id)}`, deductionId: id(d.deduction_id), type: (str(d.deduction_type) === 'One Time' ? 'One Time' : 'Monthly') as DeductionType, amountPaise: paise(d.amount) });
    deductionRows.set(key, list);
  }
  const employees: Employee[] = f.employees.filter(live).map((e) => {
    const contact = str(e.contact_number);
    const emergency = str(e.emergency_contact_number);
    const cc = str(e.contact_country) || '91';
    const ec = str(e.emergency_contact_country) || '91';
    return {
      id: id(e.id), companyId: id(e.payroll_company_id), name: str(e.name), dateOfBirth: day(e.date_of_birth), gender: str(e.gender), contactNumber: contact,
      contactCountry: cc, email: str(e.email), address: str(e.address), nationality: str(e.nationality), countryAndPincode: str(e.country_and_pincode),
      emergencyContactName: str(e.emergency_contact_name), emergencyContactRelation: str(e.emergency_contact_relation), emergencyContactNumber: emergency,
      emergencyContactCountry: ec, employeeCode: str(e.employee_code), designation: str(e.designation), department: str(e.department), shift: str(e.shift),
      joiningDate: day(e.joining_date), dailyWorkingHours: num(e.daily_working_hours), qualification: str(e.qualification),
      qualificationInstitution: str(e.qualification_institution), skills: str(e.skills), responsibilities: str(e.responsibilities), salaryPaise: paise(e.salary),
      paymentMode: str(e.payment_mode), bankName: str(e.bank_name), accountHolderName: str(e.account_holder_name), accountNumber: plain(e.account_number) || null,
      ifscCode: plain(e.ifsc_code), branchName: str(e.branch_name), deductions: deductionRows.get(id(e.id)) ?? [], idProofType: str(e.id_proof_type),
      idProofNumber: plain(e.id_proof_number) || null, resumeFileName: e.resume_path ? str(e.resume_path).split('/').pop() ?? null : null,
      photoName: e.photo_path ? str(e.photo_path).split('/').pop() ?? null : null, isActive: num(e.is_active) === 1, canEdit: true, canDelete: true,
      createdAt: stamp(e.created_at), display: { contact: formatPhone(cc, contact), emergency: formatPhone(ec, emergency) },
    };
  });

  // ---- attendance statuses, deductions, months
  const statuses: AttendanceStatus[] = f.attendanceStatuses.map((s) => ({
    id: id(s.id), companyId: id(s.payroll_company_id), name: str(s.name), shortcutKey: str(s.shortcut_key), color: str(s.color),
    attendancePercentage: num(s.attendance_percentage) as AttendancePercentage, statusType: (str(s.status_type) === 'Unpaid' ? 'Unpaid' : 'Paid') as StatusType,
    skipsFood: num(s.skips_food) === 1, isActive: num(s.is_active) === 1, usedCount: 0,
  }));
  const deductions: Deduction[] = f.deductions.map((d) => ({
    id: id(d.id), companyId: id(d.payroll_company_id), name: str(d.name), standardAmountPaise: paise(d.amount), isActive: num(d.is_active) === 1, assignedCount: 0,
  }));
  const months: MonthRecord[] = f.attendanceMonths.map((m) => {
    const month = `${num(m.year)}-${String(num(m.month)).padStart(2, '0')}`;
    const total = new Date(num(m.year), num(m.month), 0).getDate();
    const entries = new Map<string, { days: (string | null)[]; overtime: number[] }>();
    for (const e of f.attendanceEntries) {
      if (num(e.attendance_month_id) !== num(m.id)) continue;
      const key = id(e.employee_id);
      const en = entries.get(key) ?? { days: Array.from({ length: total }, () => null as string | null), overtime: Array.from({ length: total }, () => 0) };
      const d = num(e.day) - 1;
      if (d >= 0 && d < total) {
        en.days[d] = e.attendance_status_id === null || e.attendance_status_id === undefined ? null : id(e.attendance_status_id);
        en.overtime[d] = num(e.overtime_hours);
      }
      entries.set(key, en);
    }
    return {
      companyId: id(m.payroll_company_id), month, lock: (num(m.is_locked) === 1 ? 'locked' : 'editable') as AttendanceLock,
      salaryGeneratedAt: m.salary_generated_at ? stamp(m.salary_generated_at) : null, entries,
    };
  });

  const core: PayrollCoreSeed = {
    companies: coreCompanies, employees, statuses, deductions, months,
    options: {
      genders: masterList('gender'), designations: masterList('designations'), departments: masterList('departments'), paymentModes: masterList('salary_payment_mode'),
    },
  };

  // ---- pay half
  const payEmployees: PayEmployee[] = employees.map((e) => ({
    id: e.id, code: e.employeeCode, name: e.name, designation: e.designation, department: e.department, companyId: e.companyId, joiningDate: e.joiningDate,
    isActive: e.isActive, salaryPaise: e.salaryPaise, dailyWorkingHours: e.dailyWorkingHours, paymentMode: e.paymentMode, bankName: e.bankName,
    accountHolderName: e.accountHolderName, accountNumber: e.accountNumber, ifscCode: e.ifscCode, branchName: e.branchName,
    phone: formatPhone(e.contactCountry, e.contactNumber),
  }));

  const linesOf = (spId: unknown): SalaryLine[] =>
    f.salaryProcessingLines.filter((l) => num(l.salary_processing_id) === num(spId)).map((l) => ({
      category: str(l.category) as SalaryLineCategory, label: str(l.label), type: l.deduction_type ? str(l.deduction_type) : null, paise: paise(l.amount), pendingPaise: paise(l.pending_amount),
    }));
  const records: SalaryRecord[] = f.salaryProcessings.map((r) => {
    const lines = linesOf(r.id);
    const status = (paymentStatuses as string[]).includes(str(r.payment_status)) ? (str(r.payment_status) as PaymentStatus) : 'Pending';
    return {
      id: `sp-${id(r.id)}`, companyId: id(r.payroll_company_id), employeeId: id(r.employee_id), employeeCode: str(r.employee_code), employeeName: str(r.employee_name),
      designation: str(r.designation), period: `${num(r.year)}-${String(num(r.month)).padStart(2, '0')}`, processedAt: stamp(r.processed_at),
      monthlySalaryPaise: paise(r.monthly_salary), dailyWorkingHours: num(r.daily_working_hours), daysInMonth: num(r.total_days_in_month),
      days: { p0: num(r.days_0), p25: num(r.days_25), p50: num(r.days_50), p75: num(r.days_75), p100: num(r.days_100) }, payableDays: num(r.total_payable_days),
      otHours: num(r.overtime_hours), dailySalaryPaise: paise(r.daily_salary), hourlyRatePaise: paise(r.hourly_rate), attendanceSalaryPaise: paise(r.attendance_salary),
      otAmountPaise: paise(r.overtime_amount), bonusPaise: paise(r.bonus_amount), incentivePaise: paise(r.incentive_amount),
      deductions: lines.filter((l) => l.category === 'Deduction').map((l) => ({ label: l.label, paise: l.paise })), lines,
      advanceRecoveryPaise: paise(r.advance_deduction), pendingAdvancePaise: paise(r.pending_advance_amount), netPaise: paise(r.net_salary),
      paymentMode: str(r.payment_mode), bankName: str(r.bank_name), accountNumber: plain(r.account_number) || null, ifscCode: plain(r.ifsc_code), branchName: str(r.branch_name),
      paymentStatus: status, paidPaise: paise(r.paid_amount), paidOn: r.paid_at ? day(r.paid_at) : null, reference: str(r.payment_reference), remarks: str(r.payment_remarks),
      paymentUpdatedBy: r.payment_updated_by ? 'Admin' : null, generationCount: num(r.generation_count) || 1, version: 1,
    };
  });

  type AdvanceRow = PayrollPaySeed['advances'][number];
  const toAdvance = (a: Row): AdvanceRow => ({
    id: `adv${id(a.id)}`, entryNo: String(num(a.entry_no) || num(a.id)), companyId: id(a.payroll_company_id), employeeId: id(a.employee_id),
    date: `${day(a.advance_date)}T05:30:00.000Z`, amountPaise: paise(a.amount), recoveryType: (str(a.deduction_type) === 'One Time' ? 'One Time' : 'Monthly') as Advance['recoveryType'],
    instalmentPaise: paise(a.deduction_amount), recoveredPaise: paise(a.recovered_amount), isSettled: num(a.is_settled) === 1, isCarryForward: num(a.is_carry_forward) === 1,
    remarks: str(a.remarks), createdBy: num(a.is_carry_forward) === 1 ? 'System' : 'Admin',
  });
  type BonusRow = PayrollPaySeed['bonus'][number];
  const toBonus = (b: Row): BonusRow => ({
    id: `bon${id(b.id)}`, entryNo: String(num(b.entry_no) || num(b.id)), companyId: id(b.payroll_company_id), employeeId: id(b.employee_id),
    date: `${day(b.entry_date)}T06:00:00.000Z`, type: str(b.type) === 'Incentive' ? 'Incentive' : 'Bonus', amountPaise: paise(b.amount), remarks: str(b.remarks),
  });
  const toSeparation = (x: Row): SeparationSeed => ({
    id: `sep${id(x.id)}`, entryNo: `SEP-${String(num(x.entry_no) || num(x.id)).padStart(4, '0')}`, employeeId: id(x.employee_id), type: str(x.separation_type),
    resignationDate: day(x.resignation_date), lastWorkingDate: day(x.last_working_date), reason: str(x.reason), remarks: str(x.remarks),
    status: (['Pending', 'Accepted', 'Relieved'].includes(str(x.status)) ? str(x.status) : 'Pending') as SeparationStatus,
    documentName: x.document_path ? str(x.document_path).split('/').pop() ?? null : null, rejoinedOn: x.rejoined_at ? day(x.rejoined_at) : null, createdBy: 'Admin',
  });

  const letter = (kind: LetterKind, r: Row): LetterTemplate => {
    const sections = kind === 'joining'
      ? [['introduction', 'Introduction', r.introduction_content], ['responsibilities', 'Roles and responsibilities', r.roles_responsibilities], ['terms', 'Terms and conditions', r.terms_conditions],
         ['closing', 'Closing message', r.closing_message], ['acceptance', 'Acceptance by employee', r.acceptance_content]]
      : [['body', 'Body', r.body_content], ['conduct', 'Conduct remarks', r.conduct_remarks], ['closing', 'Closing message', r.closing_message]];
    const company = coreCompanies.find((c) => c.id === id(r.payroll_company_id));
    return {
      companyId: id(r.payroll_company_id), kind, subject: str(r.subject), sections: sections.map(([sid, label, text]) => ({ id: str(sid), label: str(label), text: str(text) })),
      signatoryName: str(r.authorized_name) || company?.authorizedPersonName || '', signatoryDesignation: str(r.authorized_designation) || company?.authorizedDesignation || '',
      useCompanySignatory: num(r.use_company_signatory) === 1, acceptanceHeading: kind === 'joining' ? str(r.acceptance_heading) : undefined,
      isActive: num(r.is_active) === 1, updatedAt: stamp(r.updated_at),
    };
  };

  const logs: PayrollLogEntry[] = f.logs.map((l) => ({
    id: `lg${id(l.id)}`, at: stamp(l.created_at), companyId: l.payroll_company_id === null || l.payroll_company_id === undefined ? null : id(l.payroll_company_id),
    companyName: str(l.company_name) || 'All companies', userName: str(l.user_name) || 'System',
    action: (['created', 'updated', 'deleted', 'emailed', 'error'].includes(str(l.action)) ? str(l.action) : 'updated') as LogAction, entity: str(l.entity),
    subject: str(l.subject_label), summary: str(l.summary), details: str(l.details), status: (str(l.status) === 'failed' ? 'failed' : 'success') as LogStatus,
  })).sort((a, b) => b.at.localeCompare(a.at));

  const meals = f.mealPeriods.filter(live).map((m) => ({
    id: `m${id(m.id)}`, employeeId: id(m.employee_id), startsOn: day(m.starts_on), endsOn: m.ends_on ? day(m.ends_on) : null, createdBy: 'System',
  }));
  const prices = f.foodRates.slice().sort((a, b) => str(a.effective_from).localeCompare(str(b.effective_from))).map((p) => ({
    id: `mp${id(p.id)}`, effectiveFrom: day(p.effective_from), monthlyPaise: paise(p.monthly_amount),
  }));

  const pay: PayrollPaySeed = {
    companies: payCompanies, employees: payEmployees, history: [], records,
    advances: f.advances.filter(live).map(toAdvance), advanceBin: f.advances.filter((a) => !live(a)).map(toAdvance),
    bonus: f.bonuses.filter(live).map(toBonus), bonusBin: f.bonuses.filter((b) => !live(b)).map(toBonus),
    separations: f.separations.filter(live).map(toSeparation), separationBin: f.separations.filter((x) => !live(x)).map(toSeparation),
    prices, meals,
    templates: [...f.joiningLetters.map((r) => letter('joining', r)), ...f.experienceLetters.map((r) => letter('experience', r))],
    master, log: logs,
  };
  return { core, pay };
}
