// Hotel template SQL generator v3 (PostgreSQL; all 67 Pallav hotel tables; idempotency_keys and the foundation are hand-written). Usage: node generate-hotel-sql.mjs <outDir>
// Reads pallav-tables.json (Pallav final shapes, from replay.py + report.py) and writes the group files, deviations.json, money-rules.json and money-rules.md.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const S = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const T = JSON.parse(readFileSync(path.join(S, "pallav-tables.json"), "utf8"));
const out = process.argv[2];

// salary_processings: the loop variable leaked into the replay as a column
delete T.salary_processings.$column;

const GROUPS = [
  { file: "0001_settings", title: "Settings, master lists and logs", tables: ["option_sets", "option_items", "app_settings", "business_units", "health_checks", "feature_errors", "system_logs", "user_audit_logs", "force_logs"] },
  { file: "0002_companies_crm", title: "Companies, customers and CRM", tables: ["company_profiles", "customers", "crm_leads", "crm_activities"] },
  { file: "0003_cash_books", title: "Daily cash books, expenses, handovers and staff advances", tables: ["expense_categories", "expense_items", "hotel_cash_deposits", "food_cash_deposits", "hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "expense_lines", "shift_handovers", "staff_advances"] },
  { file: "0004_billing_books", title: "Billing and the books", tables: ["accounting_years", "bill_master_advances", "bill_master_bills"] },
  { file: "0005_website", title: "Public website: content, rooms, rates, calendar, enquiries", tables: ["site_settings", "site_page_content", "site_rooms", "site_rate_plans", "site_plan_date_rates", "site_room_date_inventory", "site_reference_counters", "site_enquiries", "site_gallery_photos", "site_services", "site_policy_cards", "site_nearby_places"] },
  { file: "0006_front_office", title: "Front office: rooms, reservations, stays and charges", tables: ["pms_rooms", "pms_reservations", "pms_stays", "pms_charges"] },
  { file: "0007_payroll_core", title: "Payroll core: companies, staff, attendance, deductions, letters, meals and logs", tables: ["payroll_companies", "id_proof_types", "employees", "attendance_statuses", "attendance_months", "attendance_entries", "deductions", "employee_deductions", "joining_letters", "experience_letters", "employee_separations", "employee_meal_periods", "food_charge_rates", "meal_plan_rates", "payroll_master_items", "payroll_logs", "staff_emails"] },
  { file: "0008_payroll_pay", title: "Payroll pay: salary processing, payments, history, advances and bonuses", tables: ["salary_processings", "salary_processing_lines", "salary_update_histories", "payroll_advances", "bonus_incentives"] },
  { file: "0009_payments", title: "Online payments (Razorpay)", tables: ["razorpay_events", "razorpay_payments"] },
];

const SOFT = ["employees", "shift_handovers", "bill_master_bills", "bill_master_advances", "company_profiles", "hotel_cash_deposits", "food_cash_deposits", "hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "bonus_incentives", "payroll_advances", "employee_separations", "employee_meal_periods"];
// Tables outside the recycle bin that Pallav's own code deletes for good (a model without SoftDeletes calling ->delete()), with the
// place that does it. Only these (and the recycle-bin tables, and idempotency_keys by purge job) may be DELETEd by the hotel role.
// NOT here on purpose, though Pallav deletes them: salary_processings/_lines (SalaryProcessor.php:145 re-run, Books.php:482) and
// accounting_years + every dated money table (Books.php:441-491, "delete a year") - money and ledger rows, parked for MJ (MASTER 4.4).
const HARD_DELETE = {
  option_sets: "app/Http/Controllers/MasterDataController.php:179",
  option_items: "app/Http/Controllers/MasterDataController.php:266",
  crm_leads: "app/Http/Controllers/CrmController.php:128",
  customers: "app/Http/Controllers/CustomerController.php:194",
  expense_categories: "app/Http/Controllers/ExpenseCatalogController.php:92",
  expense_items: "app/Http/Controllers/ExpenseCatalogController.php:155",
  expense_lines: "app/Http/Controllers/ExpenseController.php:515",
  meal_plan_rates: "app/Http/Controllers/MealPlanRateController.php:67",
  attendance_entries: "app/Http/Controllers/Payroll/AttendanceController.php:120",
  attendance_statuses: "app/Http/Controllers/Payroll/AttendanceStatusController.php:99",
  deductions: "app/Http/Controllers/Payroll/DeductionController.php:77",
  employee_deductions: "app/Http/Controllers/Payroll/EmployeeController.php:273",
  experience_letters: "app/Http/Controllers/Payroll/ExperienceLetterController.php:60",
  joining_letters: "app/Http/Controllers/Payroll/JoiningLetterController.php:65",
  food_charge_rates: "app/Http/Controllers/Payroll/FoodPriceController.php:115",
  payroll_master_items: "app/Http/Controllers/Payroll/PayrollMasterController.php:115",
  pms_rooms: "app/Http/Controllers/Pms/RoomController.php:90",
  pms_charges: "app/Http/Controllers/Pms/StayController.php:176",
  site_gallery_photos: "app/Http/Controllers/Website/GalleryController.php:65",
  site_nearby_places: "app/Http/Controllers/Website/NearbyPlaceController.php:60",
  site_policy_cards: "app/Http/Controllers/Website/PolicyController.php:49",
  site_rate_plans: "app/Http/Controllers/Website/RateController.php:62",
  site_rooms: "app/Http/Controllers/Website/RoomController.php:76",
  site_services: "app/Http/Controllers/Website/ServiceController.php:49",
  site_enquiries: "app/Http/Controllers/Website/EnquiryController.php:189",
  health_checks: "app/Support/Health/Monitor.php:177 (pruned by the health job)",
  feature_errors: "app/Support/Health/Monitor.php:178 (resolved errors pruned by the health job)",
};
// Optimistic locking (D6): the service updates WHERE id = $1 AND version = $2, sets version = version + 1 and answers CONFLICT when no row
// matched; enforce_version_step() (0000_foundation.sql) refuses any UPDATE that does not raise version by exactly one.
const VERSIONED = ["pms_reservations", "pms_stays", "bill_master_bills", "bill_master_advances", "hotel_cash_deposits", "food_cash_deposits", "hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "shift_handovers", "salary_processings"];
const ENTRY = ["hotel_cash_deposits", "food_cash_deposits", "hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "staff_advances", "shift_handovers", "bill_master_bills", "bill_master_advances", "payroll_advances", "bonus_incentives", "employee_separations"];
const APPEND_ONLY = { health_checks: "a health probe result per check, never edited", system_logs: "what happened and who did it, never edited", user_audit_logs: "what was done to a user account, never edited", force_logs: "every force-mode override, never edited", payroll_logs: "what was done in payroll and who did it, never edited" };
// tables people edit: they get created_by / updated_by (plain uuid, set by the service; NULL for imported rows)
const AUDIT = ["company_profiles", "customers", "crm_leads", "hotel_cash_deposits", "food_cash_deposits", "hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "shift_handovers", "staff_advances", "bill_master_advances", "bill_master_bills", "site_settings", "site_page_content", "site_rooms", "site_rate_plans", "site_enquiries", "site_gallery_photos", "site_services", "site_policy_cards", "site_nearby_places", "pms_rooms", "pms_reservations", "pms_stays", "pms_charges", "payroll_companies", "employees", "deductions", "employee_deductions", "joining_letters", "experience_letters", "employee_separations", "employee_meal_periods", "food_charge_rates", "meal_plan_rates", "payroll_advances", "bonus_incentives"];
const USER_REF_NO_INDEX = new Set(["created_by", "updated_by", "modified_by", "deleted_by", "started_by", "closed_by"]);
const NON_MONEY_NAME = /percentage|percent|_hours$|^hours|quantity|^days_|total_payable_days|map_lat|map_lng|origin_lat|origin_lng/;

const B = ["hotel", "food"];
const OV = {
  option_sets: { enums: { input: ["select", "radio", "checkbox"] } },
  option_items: { indexes: [[["option_set_id", "sort_order"]]] },
  app_settings: { note: 'Settings the hotel changes on screen. is_secret rows are integration secrets: stored as plain text, never returned by any API (the app answers "set" only).' },
  business_units: {},
  health_checks: { enums: { status: ["ok", "warn", "down"] } },
  feature_errors: { addCols: ["created_at", "updated_at"], indexes: [[["last_seen_at"], "resolved_at IS NULL"]] },
  system_logs: { extraCols: ["trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$')"], enums: { status: ["success", "failed"] }, indexes: [[["action", "created_at"]], [["status", "created_at"]]] },
  user_audit_logs: {},
  force_logs: {},
  company_profiles: { dropPrefix: ["md_", "hr_head", "assistant_hr", "accountant_head", "accountant_assistant"], dropReason: "Pallav's 21 fixed contact-slot columns (md_one_*, hr_head_*, ...) were folded into the contacts list and 'stay in the table, unused'; not carried over", indexes: [[["created_at", "id"]], [["gst_number"], "gst_number IS NOT NULL"]] },
  customers: { drop: ["password", "must_change_password", "last_login_at"], dropReason: "portal sign-in details live in platform.users (password hash, forced change, last login); the guest record keeps only guest data", enums: { source: ["admin", "self"] }, indexes: [[["created_at", "id"]]] },
  crm_leads: { checks: ["-- Pallav: CrmController.php:76 'check_out' => nullable|date|after_or_equal:check_in", "CONSTRAINT crm_leads_dates_ck CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in)"], enums: { stage: ["new", "contacted", "quoted", "booked", "lost"] }, indexes: [[["stage", "next_follow_up"]], [["stage", "updated_at"]]] },
  crm_activities: { enums: { type: ["call", "whatsapp", "email", "visit", "note", "stage"] } },
  expense_categories: { enums: { business: B } },
  expense_items: {},
  hotel_cash_deposits: { drop: ["revenue_source"], dropReason: "Pallav carried it into reason and left the column unused", indexes: [[["date", "time"]]] },
  food_cash_deposits: { drop: ["revenue_source"], dropReason: "Pallav carried it into reason and left the column unused", indexes: [[["date", "time"]]] },
  hotel_cash_withdrawals: { indexes: [[["date", "time"]]] },
  food_cash_withdrawals: { indexes: [[["date", "time"]]] },
  hotel_misc_expenses: { indexes: [[["date", "time"]]] },
  food_misc_expenses: { indexes: [[["date", "time"]]] },
  expense_lines: { enums: { business: B, pricing: ["listed", "custom"] } },
  shift_handovers: { indexes: [[["date", "time"]]] },
  staff_advances: { enums: { business: B }, indexes: [[["date", "time"]], [["business", "date"]]] },
  accounting_years: { checks: ["-- domain rule: a year ends on or after the day it starts", "CONSTRAINT accounting_years_dates_ck CHECK (ends_on >= starts_on)"] },
  bill_master_advances: { indexes: [[["payment_date"]], [["refund_payment_date"], "refund_payment_date IS NOT NULL"], [["company_id", "payment_date"]]] },
  bill_master_bills: { extraCols: ["hotel_gst_percent numeric(5, 2) CHECK (hotel_gst_percent BETWEEN 0 AND 28)", "food_gst_percent numeric(5, 2) CHECK (food_gst_percent BETWEEN 0 AND 28)"], checks: ["-- Pallav: BillMasterController.php:357 'departure_at' => nullable|date|after_or_equal:arrival_at", "CONSTRAINT bill_master_bills_stay_ck CHECK (arrival_at IS NULL OR departure_at IS NULL OR departure_at >= arrival_at)"], indexes: [[["bill_date"]], [["debit_bill_date"], "debit_bill_date IS NOT NULL"], [["company_id", "bill_date"]]] },

  site_settings: {
    noDefault: ["opened_year", "gm_phone", "reception_phone", "whatsapp", "email"],
    nullable: ["opened_year", "gm_phone", "reception_phone", "whatsapp", "email"],
    defaultOverride: { address: "''" },
    ranges: { map_lat: "BETWEEN -90 AND 90", map_lng: "BETWEEN -180 AND 180", google_min_review_rating: "BETWEEN 1 AND 5" },
    singleton: true,
    note: "One row per hotel (the hotel's public website settings). Hotel Pallav's own phone numbers, email and opening year are not baked in as defaults: they come from the import or the hotel's setup.",
  },
  site_page_content: {
    singleton: true,
    note: "One row per hotel (the public website's wording).",
    // Pallav's default text contains a closing bracket, which the replay cut short; the exact strings are in its website migration
    defaultOverride: {
      fm_msg_children: "'Please enter the number of children (0 if none).'",
      fm_msg_message: "'Please tell us anything we should know (or write \"none\").'",
    },
  },
  site_rooms: { indexes: [[["sort_order", "id"]]] },
  site_rate_plans: { moneyInt: ["price_double", "price_single", "extra_person_price"], note: "Prices were whole rupees in Pallav; here they are paise (the import multiplies by 100). occupancy_prices holds paise too." },
  site_plan_date_rates: { moneyInt: ["price_double", "price_single"] },
  site_room_date_inventory: {},
  site_reference_counters: { raw: true },
  site_enquiries: { checks: ["-- Pallav: Website/EnquiryController.php:80 'check_out' => after_or_equal:check_in", "CONSTRAINT site_enquiries_dates_ck CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in)"], enums: { status: ["new", "pending", "confirmed", "declined"] } },
  site_gallery_photos: {},
  site_services: {},
  site_policy_cards: {},
  site_nearby_places: { ranges: { origin_lat: "BETWEEN -90 AND 90", origin_lng: "BETWEEN -180 AND 180" } },

  pms_rooms: { indexes: [[["sort_order", "number"]]], enums: { hk_status: ["clean", "dirty"] } },
  pms_reservations: { checks: ["-- Pallav: Pms/ReservationController.php:189 'check_out' => required|date|after:check_in", "CONSTRAINT pms_reservations_dates_ck CHECK (check_out > check_in)"], indexes: [[["status", "check_out"]]], enums: { status: ["confirmed", "checked_in", "checked_out", "cancelled", "no_show"], source: ["walk_in", "phone", "website", "company", "agent", "other"] }, ranges: { rooms: "BETWEEN 1 AND 50", adults: "BETWEEN 1 AND 99", children: "BETWEEN 0 AND 99" } },
  pms_stays: { extraCols: ["hotel_gst_percent numeric(5, 2) CHECK (hotel_gst_percent BETWEEN 0 AND 28)", "food_gst_percent numeric(5, 2) CHECK (food_gst_percent BETWEEN 0 AND 28)"], extra: ["-- Pallav: Pms/StayController.php:94-98,107 refuses a check-in while the room has an in-house stay (checked in code, racy); this index makes it a database rule", "CREATE UNIQUE INDEX pms_stays_one_in_house_per_room_key ON pms_stays (room_id) WHERE status = 'in_house';"], checks: ["-- Pallav: Pms/StayController.php:90,204 'expected_check_out' => after:today / after the check-in day (IST)", "CONSTRAINT pms_stays_expected_out_ck CHECK (expected_check_out > (check_in_at AT TIME ZONE 'Asia/Kolkata')::date)", "-- domain rule: Pms/StayController.php:243 sets check_out_at at check-out, which is never before check-in", "CONSTRAINT pms_stays_actual_out_ck CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)"], indexes: [[["status", "check_out_at"]]], enums: { status: ["in_house", "checked_out"] }, ranges: { adults: "BETWEEN 1 AND 20", children: "BETWEEN 0 AND 20" } },
  pms_charges: { enums: { category: ["food", "room_service", "laundry", "extra_bed", "other"], side: B } },

  payroll_companies: {},
  id_proof_types: {},
  employees: { ranges: { daily_working_hours: "BETWEEN 0.5 AND 24" }, rawIndexes: [["employees_payroll_company_id_email_key", "CREATE UNIQUE INDEX employees_payroll_company_id_email_key ON employees (payroll_company_id, email) WHERE deleted_at IS NULL AND email IS NOT NULL;"]], indexes: [[["payroll_company_id", "joining_date"]], [["payroll_company_id", "is_active"]], [["payroll_company_id", "is_active", "name"]]] },
  attendance_statuses: { ranges: { attendance_percentage: "BETWEEN 0 AND 100" } },
  attendance_months: { ranges: { year: "BETWEEN 2000 AND 2200", month: "BETWEEN 1 AND 12" } },
  attendance_entries: { ranges: { day: "BETWEEN 1 AND 31", attendance_percentage: "BETWEEN 0 AND 100" } },
  deductions: {},
  employee_deductions: {},
  joining_letters: {},
  experience_letters: {},
  employee_separations: { checks: ["-- Pallav: Payroll/SeparationController.php:41 'last_working_date' => after_or_equal:resignation_date", "CONSTRAINT employee_separations_dates_ck CHECK (last_working_date >= resignation_date)"], enums: { status: ["Pending", "Accepted", "Relieved"] }, indexes: [[["payroll_company_id", "last_working_date"]]] },
  employee_meal_periods: { checks: ["-- Pallav: Payroll/FoodChargeController.php:82,120 'ends_on' => after_or_equal:starts_on", "CONSTRAINT employee_meal_periods_dates_ck CHECK (ends_on IS NULL OR ends_on >= starts_on)"] },
  food_charge_rates: {},
  meal_plan_rates: {},
  payroll_master_items: {
    // the shared lists (company NULL) and a company's own entries cannot repeat a label: this is what makes the seeds idempotent
    rawIndexes: [
      ["payroll_master_items_shared_key", "CREATE UNIQUE INDEX payroll_master_items_shared_key ON payroll_master_items (list, label) WHERE payroll_company_id IS NULL;"],
      ["payroll_master_items_company_key", "CREATE UNIQUE INDEX payroll_master_items_company_key ON payroll_master_items (payroll_company_id, list, label) WHERE payroll_company_id IS NOT NULL;"],
    ],
    notes2: "unique labels per list (Pallav had none)",
  },
  payroll_logs: { enums: { action: ["created", "updated", "deleted", "emailed", "error"], status: ["success", "failed"] } },
  staff_emails: { enums: { status: ["sending", "sent", "failed"] } },

  salary_processings: { indexes: [[["payroll_company_id", "year", "month"]], [["employee_id"]], [["payroll_company_id", "year", "month", "employee_name"]], [["payroll_company_id", "employee_id", "year", "month"]]], ranges: { year: "BETWEEN 2000 AND 2200", month: "BETWEEN 1 AND 12", daily_working_hours: "BETWEEN 0.5 AND 24", days_0: "BETWEEN 0 AND 31", days_25: "BETWEEN 0 AND 31", days_50: "BETWEEN 0 AND 31", days_75: "BETWEEN 0 AND 31", days_100: "BETWEEN 0 AND 31", total_payable_days: "BETWEEN 0 AND 31" } },
  salary_processing_lines: {},
  salary_update_histories: { indexes: [[["employee_id", "effective_date", "field_name"]]] },
  payroll_advances: { enums: { deduction_type: ["One Time", "Monthly"] }, indexes: [[["payroll_company_id", "advance_date"]], [["employee_id", "is_settled"]], [["employee_id", "is_settled", "advance_date"]]] },
  bonus_incentives: { enums: { type: ["Bonus", "Incentive"] }, indexes: [[["payroll_company_id", "entry_date"]], [["employee_id", "entry_date"]]] },

  razorpay_events: { enums: { business: B }, external: "event and status are Razorpay's own strings; they are not ours to restrict" },
  razorpay_payments: { enums: { business: B }, external: "event and status are Razorpay's own strings; they are not ours to restrict" },
};

// ---- money sign rules: [rule, Pallav source]; rule is ">0", ">=0" or "signed" ----
const GT0 = ">0";
const GE0 = ">=0";
const SIGNED = "signed";
const MONEY = {
  hotel_cash_deposits: { _: [GT0, "RevenueController.php:145 amount min:0.01"] },
  food_cash_deposits: { _: [GT0, "RevenueController.php:145 amount min:0.01"] },
  hotel_cash_withdrawals: { _: [GT0, "ExpenseController.php:276 amount min:0.01"] },
  food_cash_withdrawals: { _: [GT0, "ExpenseController.php:276 amount min:0.01"] },
  hotel_misc_expenses: { _: [GT0, "ExpenseController.php:276 amount min:0.01"] },
  food_misc_expenses: { _: [GT0, "ExpenseController.php:276 amount min:0.01"] },
  staff_advances: { _: [GT0, "ExpenseController.php:276 amount min:0.01"] },
  expense_items: { _: [GE0, "ExpenseCatalogController.php:108 price min:0"] },
  expense_lines: { _: [GE0, "ExpenseController.php:296 custom amount min:0.01; listed price from the catalog (min:0); total = quantity x price"] },
  shift_handovers: { _: [GE0, "counted cash: notes counted x denomination (ShiftHandoverController::store); never entered as a negative"] },
  crm_leads: { _: [GE0, "CrmController.php:78 value min:0"] },
  bill_master_advances: {
    hotel_amount: [GE0, "BillMasterController.php:141,200 min:0"],
    food_amount: [GE0, "BillMasterController.php:142,201 min:0"],
    hotel_refund_amount: [GE0, "BillMasterController.php:246 min:0"],
    food_refund_amount: [GE0, "BillMasterController.php:247 min:0"],
    _: [GE0, "BillMasterController.php:259-264 a refund cannot exceed the balance; :438-439 max(0, ...)"],
  },
  bill_master_bills: {
    balance_hotel_amount: [GE0, "BillMasterController.php:538 max(0, remaining)"],
    balance_food_amount: [GE0, "BillMasterController.php:539 max(0, remaining)"],
    advance_hotel_amount: [GE0, "BillMasterController.php:433 min(advance balance, total)"],
    advance_food_amount: [GE0, "BillMasterController.php:434 min(advance balance, total)"],
    advance_delete_hotel_amount: [GE0, "BillMasterController.php:485 a copy of the advance amount applied"],
    advance_delete_food_amount: [GE0, "BillMasterController.php:486 a copy of the advance amount applied"],
    plan_food_amount: [GE0, "MealPlanRate::price: rate_per_person (min:0) x persons x nights"],
    total_hotel_amount: [SIGNED, "BillMasterController.php:379 the sum of the lines, and a line may be a negative adjustment"],
    total_food_amount: [SIGNED, "BillMasterController.php:379 the sum of the lines, and a line may be a negative adjustment"],
    _: [SIGNED, "BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment"],
  },
  site_rate_plans: { _: [GE0, "Website/RateController.php:116 and CalendarController.php:107,284 price >= 0"] },
  site_plan_date_rates: { _: [GE0, "Website/CalendarController.php:107,284 price >= 0"] },
  pms_reservations: { _: [GE0, "Pms/ReservationController.php:185 rate min:0"] },
  pms_stays: { _: [GE0, "Pms/StayController.php:89 rate min:0"] },
  pms_charges: { unit_price: [GE0, "Pms/StayController.php:154 unit_price min:0"], _: [GE0, "Pms/StayController.php:153-159 quantity (min:0.01) x unit_price (min:0)"] },
  employees: { _: [GE0, "Payroll/EmployeeController.php:63 salary min:0"] },
  deductions: { _: [GE0, "Payroll/DeductionController.php:36 amount min:0"] },
  employee_deductions: { _: [GE0, "Payroll/EmployeeController.php:121 amount min:0"] },
  payroll_advances: { amount: [GT0, "Payroll/PayrollAdvanceController.php:70 gt:0"], deduction_amount: [GE0, "Payroll/PayrollAdvanceController.php:75 min:0"], _: [GE0, "computed by SalaryProcessor: instalments recovered, never above the advance"] },
  bonus_incentives: { _: [GT0, "Payroll/BonusIncentiveController.php:75 gt:0"] },
  salary_processings: { net_salary: [SIGNED, "SalaryProcessor.php:279 net can fall below zero when deductions exceed earnings; SalaryProcessing::outstanding() clamps with max(0, ...)"], paid_amount: [GE0, "Payroll/SalaryPaymentController.php:65 paid_amount min:0"], _: [GE0, "SalaryProcessor.php:194-279 computed from non-negative inputs (salary min:0, hours min:0)"] },
  salary_processing_lines: { _: [GE0, "SalaryProcessor.php:406-407 deducted <= outstanding, pending = outstanding - deducted"] },
  food_charge_rates: { _: [GE0, "Payroll/FoodPriceController.php:72 monthly_amount min:0"] },
  meal_plan_rates: { _: [GE0, "MealPlanRateController.php:42 rate_per_person min:0"] },
  razorpay_payments: { _: [GE0, "RazorpayWebhookController.php:99-103 amounts come from Razorpay (paise / 100), never negative"] },
};

const sqlStr = (s) => `'${s.replace(/'/g, "''")}'`;
const phpDefault = (d) => {
  if (d === "true" || d === "false") return d;
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  if (/^'.*'$/.test(d) || /^".*"$/.test(d)) return sqlStr(d.slice(1, -1));
  if (d === "null") return "NULL";
  throw new Error("default " + d);
};
const plural = (w) => (w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`);

const created = new Set();
const deferred = [];
const deviations = {};
const allIdx = new Set();
const moneyRules = [];

function expandCols(table) {
  const cols = {};
  for (const [k, c] of Object.entries(T[table])) {
    if (k === "__idx") continue;
    if (k.includes("{$suffix}")) for (const s of ["", "_1", "_2", "_3", "_4"]) cols[k.replace("{$suffix}", s)] = { ...c, name: k.replace("{$suffix}", s) };
    else cols[k] = { ...c, name: k };
  }
  return cols;
}
function fkTarget(c) {
  const m = c.mods.find((x) => x.startsWith("constrained"));
  if (!m) return null;
  return /^constrained='(\w+)'/.exec(m)?.[1] ?? plural(c.name.replace(/_id$/, ""));
}
const onDelete = (c) => (c.mods.includes("cascadeOnDelete") ? "CASCADE" : c.mods.includes("nullOnDelete") ? "SET NULL" : "RESTRICT");

function moneyRule(table, name) {
  const r = MONEY[table];
  if (!r) throw new Error(`no money rule for ${table}.${name}`);
  return r[name] ?? r._;
}

function gen(group) {
  const parts = [];
  const rollbackParts = [];
  const fkAlters = [];
  const here = [];
  for (const table of group.tables) {
    const ov = OV[table];
    if (!ov) throw new Error("no override entry for " + table);
    const dev = (deviations[table] = { drop: [], add: [], renamed: {}, notes: [] });
    const soft = SOFT.includes(table);
    const entry = ENTRY.includes(table);
    const append = APPEND_ONLY[table];
    const audit = AUDIT.includes(table);
    const sql = [];
    if (ov.raw) {
      if (table !== "site_reference_counters") throw new Error("raw " + table);
      sql.push("-- no-standard-columns: one row per fiscal year (1 Apr - 31 Mar IST), keyed by the year; numbers come from INSERT ... ON CONFLICT (fiscal_year) DO UPDATE ... RETURNING");
      sql.push("CREATE TABLE site_reference_counters (\n  fiscal_year smallint PRIMARY KEY CHECK (fiscal_year BETWEEN 2000 AND 2200),\n  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0)\n);");
      parts.push(sql.join("\n"));
      created.add(table);
      here.push(table);
      rollbackParts.unshift(`DROP TABLE IF EXISTS ${table};`);
      dev.notes.push("keyed by fiscal_year (Pallav's primary key); no uuid id, legacy_id or timestamps");
      dev.noStandardColumns = true;
      continue;
    }
    const cols = expandCols(table);
    if (cols.modified_by) {
      dev.renamed.modified_by = "updated_by";
    }
    const idxSrc = T[table].__idx?.args ?? [];
    const lines = [];
    const indexes = [];
    const idx = (name, def) => {
      if (name.length > 63) throw new Error("index name too long " + name);
      if (allIdx.has(name)) throw new Error("dup index " + name);
      allIdx.add(name);
      indexes.push(def);
    };
    lines.push("  id uuid PRIMARY KEY DEFAULT uuidv7()");
    lines.push("  legacy_id bigint");
    dev.add.push("legacy_id");
    const dropped = (n) => (ov.drop ?? []).includes(n) || (ov.dropPrefix ?? []).some((p) => n.startsWith(p));
    const colIndexed = new Set();

    for (const [name, c] of Object.entries(cols)) {
      if (["id", "created_at", "updated_at", "deleted_at", "deleted_by", "entry_no"].includes(name)) continue;
      if (dropped(name)) { dev.drop.push(name); continue; }
      const isEncrypted = false; // nothing is encrypted by the application: every column keeps Pallav's own type
      let nullable = c.mods.includes("nullable") || (ov.nullable ?? []).includes(name);
      let defMod = c.mods.find((m) => m.startsWith("default="));
      if ((ov.noDefault ?? []).includes(name)) defMod = undefined;
      if (ov.defaultOverride?.[name]) defMod = `default=${ov.defaultOverride[name]}`;
      let colName = dev.renamed[name] ?? name;
      let type;
      const extra = [];
      let moneyColumn = false;
      switch (c.type) {
        case "string": type = ov.enums?.[name] ? "text" : `varchar(${c.args[0] ?? 255})`; break;
        case "text": case "longText": case "mediumText": type = "text"; break;
        case "enum": type = "text"; break;
        case "decimal": {
          const [p, s] = c.args;
          if (s !== "2" || NON_MONEY_NAME.test(name)) type = `numeric(${p}, ${s})`;
          else { colName = `${name}_paise`; dev.renamed[name] = colName; type = "bigint"; moneyColumn = true; }
          break;
        }
        case "boolean": type = "boolean"; break;
        case "date": type = "date"; break;
        case "time": type = "time"; break;
        case "timestamp": case "dateTime": type = "timestamptz"; break;
        case "json": type = "jsonb"; break;
        case "integer": type = "integer"; break;
        case "unsignedTinyInteger": type = "smallint"; if (!ov.ranges?.[name]) extra.push(`CHECK (${colName} BETWEEN 0 AND 255)`); break;
        case "unsignedSmallInteger": type = "integer"; if (!ov.ranges?.[name]) extra.push(`CHECK (${colName} BETWEEN 0 AND 65535)`); break;
        case "unsignedInteger":
          if ((ov.moneyInt ?? []).includes(name)) { colName = `${name}_paise`; dev.renamed[name] = colName; moneyColumn = true; type = "bigint"; }
          else { type = "bigint"; if (!ov.ranges?.[name]) extra.push(`CHECK (${colName} >= 0)`); }
          break;
        case "unsignedBigInteger": type = "uuid"; break;
        case "foreignId": type = "uuid"; break;
        case "uuid": type = "uuid"; break;
        default: throw new Error(`${table}.${name}: type ${c.type}`);
      }
      if (isEncrypted) type = "text";
      let line = `  ${colName} ${type}`;
      if (!nullable) line += " NOT NULL";
      if (defMod) line += ` DEFAULT ${phpDefault(defMod.slice(8))}`;
      else if (c.mods.includes("useCurrent")) line += " DEFAULT now()";
      const enumValues = ov.enums?.[name] ?? (c.type === "enum" ? [...c.args.join(" ").matchAll(/'([^']*)'/g)].map((m) => m[1]) : null);
      if (enumValues) line += ` CHECK (${colName} IN (${enumValues.map(sqlStr).join(", ")}))`;
      if (extra.length) line += ` ${extra.join(" ")}`;
      // numeric (non-money) ranges
      if (c.type === "decimal" && !moneyColumn) {
        const custom = ov.ranges?.[name];
        if (custom) line += ` CHECK (${colName} ${custom})`;
        else if (/percentage|percent/.test(name)) line += ` CHECK (${colName} BETWEEN 0 AND 100)`;
        else if (/quantity|hours|^days_|total_payable_days/.test(name)) line += ` CHECK (${colName} >= 0)`;
        else throw new Error(`${table}.${name}: numeric without a range rule`);
      } else if (ov.ranges?.[name]) line += ` CHECK (${colName} ${ov.ranges[name]})`;
      // money sign rule
      if (moneyColumn) {
        const [rule, source] = moneyRule(table, name);
        moneyRules.push({ table, column: colName, rule, source });
        if (rule === GT0) line += ` CHECK (${colName} > 0)`;
        else if (rule === GE0) line += ` CHECK (${colName} >= 0)`;
        else lines.push(`  -- may be negative: ${source}`);
      }

      // foreign keys
      const target = c.type === "foreignId" ? fkTarget(c) : null;
      const plainNoFk = c.mods.includes("PLAIN_REF_no_fk");
      if (target === "users" || (target && plainNoFk)) {
        if (!USER_REF_NO_INDEX.has(name) && !(plainNoFk && idxSrc.some((a) => a.includes(`'${name}'`) && a.startsWith("unique")))) {
          idx(`${table}_${colName}_idx`, `CREATE INDEX ${table}_${colName}_idx ON ${table} (${colName});`);
          colIndexed.add(colName);
        }
        if (plainNoFk) dev.notes.push(`${colName}: no foreign key (history record; Pallav cut the tie so deleting an employee/company never deletes salary history); indexed reference`);
        lines.push(line);
        continue;
      }
      if (target) {
        const ready = target === table || created.has(target) || here.includes(target);
        if (ready) {
          let action = onDelete(c);
          if (append && action !== "RESTRICT") {
            action = "RESTRICT";
            dev.notes.push(`${colName}: ON DELETE ${onDelete(c)} became RESTRICT (an append-only table is never rewritten; the parent is soft-deleted)`);
          }
          if (soft && action === "CASCADE") {
            action = "RESTRICT";
            dev.notes.push(`${colName}: Pallav ON DELETE CASCADE became RESTRICT (a money or booking record is never deleted with its parent; parents are soft-deleted)`);
          }
          line += ` REFERENCES ${target} (id) ON DELETE ${action}`;
        } else {
          deferred.push({ table, column: colName, target, action: onDelete(c) });
        }
        const compositeFirst = idxSrc.some((a) => new RegExp(`^(${soft ? "index" : "unique|index"}):\\[\\s*'${name}'\\s*,`).test(a));
        if (c.mods.includes("unique")) {
          const nm = `${table}_${colName}_key`;
          idx(nm, `CREATE UNIQUE INDEX ${nm} ON ${table} (${colName})${soft ? " WHERE deleted_at IS NULL" : ""};`);
        } else if (!compositeFirst) idx(`${table}_${colName}_idx`, `CREATE INDEX ${table}_${colName}_idx ON ${table} (${colName});`);
        lines.push(line);
        continue;
      }
      lines.push(line);
      if (c.mods.includes("unique")) {
        const nm = `${table}_${colName}_key`;
        idx(nm, `CREATE UNIQUE INDEX ${nm} ON ${table} (${colName})${soft ? " WHERE deleted_at IS NULL" : ""};`);
      }
      if (c.mods.includes("index")) idx(`${table}_${colName}_idx`, `CREATE INDEX ${table}_${colName}_idx ON ${table} (${colName});`);
      if (c.mods.includes("ENCRYPTED") === false && c.type === "unsignedBigInteger") { /* plain polymorphic reference: no index unless Pallav had one */ }
    }

    // created_by / updated_by on tables people edit
    if (audit) {
      if (!cols.created_by) { lines.push("  created_by uuid"); dev.add.push("created_by"); }
      if (!cols.modified_by && !cols.updated_by) { lines.push("  updated_by uuid"); dev.add.push("updated_by"); }
    }
    if (cols.modified_by) {
      const i = lines.findIndex((l) => l.startsWith("  modified_by "));
      if (i >= 0) lines[i] = lines[i].replace("  modified_by ", "  updated_by ");
    }

    idx(`${table}_legacy_id_key`, `CREATE UNIQUE INDEX ${table}_legacy_id_key ON ${table} (legacy_id) WHERE legacy_id IS NOT NULL;`);
    if (ov.singleton) idx(`${table}_singleton_key`, `CREATE UNIQUE INDEX ${table}_singleton_key ON ${table} ((true));`);
    for (const [nm, def] of ov.rawIndexes ?? []) idx(nm, def);

    // composite / extra indexes from Pallav
    for (const a of idxSrc) {
      const m = /^(unique|index):(.*)$/.exec(a);
      if (!m) continue;
      const colsIn = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (colsIn.includes("entry_no") || m[2].includes("self::")) continue;
      const mapped = colsIn.map((x) => dev.renamed[x] ?? x);
      if (!mapped.every((x) => ["created_at", "updated_at"].includes(x) || lines.some((l) => l.startsWith(`  ${x} `)))) continue;
      const nm = `${table}_${mapped.join("_")}_${m[1] === "unique" ? "key" : "idx"}`.slice(0, 63);
      if (indexes.some((d) => d.includes(` ${nm} `))) continue;
      idx(nm, `CREATE ${m[1] === "unique" ? "UNIQUE " : ""}INDEX ${nm} ON ${table} (${mapped.join(", ")})${m[1] === "unique" && soft ? " WHERE deleted_at IS NULL" : ""};`);
    }
    for (const [colsX, where] of ov.indexes ?? []) {
      const nm = `${table}_${colsX.join("_")}_idx`.slice(0, 63);
      if (allIdx.has(nm)) continue;
      idx(nm, `CREATE INDEX ${nm} ON ${table} (${colsX.join(", ")})${where ? " WHERE " + where : ""};`);
    }

    if (entry) {
      lines.push("  entry_no bigint NOT NULL CHECK (entry_no >= 1)");
      idx(`${table}_entry_no_key`, `CREATE UNIQUE INDEX ${table}_entry_no_key ON ${table} (entry_no);`);
      dev.notes.push("entry_no is NOT NULL here (Pallav: nullable until backfilled); UNIQUE counts soft-deleted rows too (Pallav rule)");
    }
    for (const c of ov.extraCols ?? []) {
      lines.push("  " + c);
      const named = /^(\w+)/.exec(c)?.[1];
      if (named && !dev.add.includes(named)) dev.add.push(named);
      if (named === "hotel_gst_percent") dev.notes.push("hotel_gst_percent and food_gst_percent: the GST percent actually used at check-out, stored with the record (MJ #19); NULL until check-out, checked 0..28; the defaults come from app_settings checkout.*_gst_percent");
    }
    if (soft) {
      lines.push("  deleted_at timestamptz");
      lines.push("  deleted_by uuid");
      idx(`${table}_deleted_at_idx`, `CREATE INDEX ${table}_deleted_at_idx ON ${table} (deleted_at) WHERE deleted_at IS NOT NULL;`);
    }
    const hasCreated = "created_at" in cols;
    const hasUpdated = "updated_at" in cols;
    if (append) {
      if (!hasCreated && !("checked_at" in cols)) throw new Error(table + " needs an at column");
      if (hasCreated) lines.push("  created_at timestamptz NOT NULL DEFAULT now()");
    } else {
      lines.push("  created_at timestamptz NOT NULL DEFAULT now()");
      lines.push("  updated_at timestamptz NOT NULL DEFAULT now()");
      if (VERSIONED.includes(table)) lines.push("  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)");
      if (!hasCreated) dev.add.push("created_at");
      if (!hasUpdated) dev.add.push("updated_at");
    }
    lines.push(...(ov.checks ?? []).map((ch) => `  ${ch}`));
    if (dev.drop.length) dev.notes.push(`dropped: ${dev.drop.join(", ")}${ov.dropReason ? " (" + ov.dropReason + ")" : ""}`);
    if (ov.note && !ov.note.startsWith("Settings the hotel")) dev.notes.push(ov.note);
    if (ov.notes2) dev.notes.push(ov.notes2);
    if (ov.singleton) dev.notes.push("singleton: a unique index on ((true)) allows only one row per hotel (R3)");
    if ((ov.moneyInt ?? []).length) dev.notes.push(`${ov.moneyInt.join(", ")}: whole rupees in Pallav, paise here (import x100)`);
    for (const k of ov.noDefault ?? []) dev.notes.push(`${k}: Pallav's hotel-specific default value is not baked into the template`);

    const body = [];
    const realCount = lines.filter((l) => !l.trim().startsWith("--")).length;
    let remaining = realCount;
    for (const l of lines) {
      if (l.trim().startsWith("--")) { body.push(l); continue; }
      remaining--;
      body.push(remaining > 0 ? `${l},` : l);
    }
    if (soft) sql.push("-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)");
    else if (HARD_DELETE[table]) sql.push(`-- hard-delete: Pallav ${HARD_DELETE[table]}`);
    if (append) sql.push(`-- append-only: ${append}${HARD_DELETE[table] ? ", purged by age" : ""}`);
    if (ov.external) sql.push(`-- external-values: ${ov.external}`);
    if (ov.note) sql.push(`-- ${ov.note}`);
    sql.push(`CREATE TABLE ${table} (`, ...body, ");", ...indexes, ...(ov.extra ?? []));
    if (!append) sql.push(`CREATE TRIGGER ${table}_touch_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
    if (VERSIONED.includes(table)) sql.push(`CREATE TRIGGER ${table}_version_step BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION enforce_version_step();`);
    parts.push(sql.join("\n"));
    created.add(table);
    here.push(table);
    rollbackParts.unshift(`DROP TABLE IF EXISTS ${table};`);
  }

  // foreign keys that were waiting for a table created in this file
  const ready = deferred.filter((d) => here.includes(d.target));
  for (const d of ready) {
    deferred.splice(deferred.indexOf(d), 1);
    const nm = `${d.table}_${d.column}_fkey`;
    fkAlters.push(`ALTER TABLE ${d.table} ADD CONSTRAINT ${nm} FOREIGN KEY (${d.column}) REFERENCES ${d.target} (id) ON DELETE ${d.action};`);
    rollbackParts.unshift(`ALTER TABLE ${d.table} DROP CONSTRAINT IF EXISTS ${nm};`);
    (deviations[d.table].addedFks ??= []).push({ column: d.column, target: d.target, action: d.action, file: group.file });
  }
  const tail = fkAlters.length ? `\n\n-- foreign keys from earlier tables that point at tables created in this file\n${fkAlters.join("\n")}` : "";
  return `-- rollback: ${rollbackParts.join(" ")}\n-- ${group.title}. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.\n\n${parts.join("\n\n")}${tail}\n`;
}

for (const g of GROUPS) writeFileSync(path.join(out, `${g.file}.sql`), gen(g));
if (deferred.length) throw new Error("unresolved deferred foreign keys: " + JSON.stringify(deferred));
writeFileSync(path.join(out, "deviations.json"), JSON.stringify({ deviations }, null, 1));
writeFileSync(path.join(out, "money-rules.json"), JSON.stringify(moneyRules, null, 1));
const md = ["| Table | Column | Rule | Pallav source |", "|---|---|---|---|", ...moneyRules.map((r) => `| ${r.table} | ${r.column} | ${r.rule === GT0 ? "> 0" : r.rule === GE0 ? ">= 0" : "may be negative"} | ${r.source} |`)];
writeFileSync(path.join(out, "money-rules.md"), md.join("\n") + "\n");
console.log("tables:", created.size, "money columns:", moneyRules.length);
