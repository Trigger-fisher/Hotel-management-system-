# S08 fixtures: Pallav demo data (same data on both sides)

Exported by the UI reviewer from the SCRATCH Pallav copy (`%LOCALAPPDATA%\HMS\pallav-ref`, demo seeders + a front-office demo seeder), 48 tables, one JSON file per table, `_manifest.json` lists row counts. Secrets (passwords, tokens, OTP, 2FA) are removed. No real hotel data. Column names are Pallav's own (snake_case); money is rupees with 2 decimals as Pallav stores it.

Use: load these rows as the mock data of the screen under review, so Pallav and HMS show the SAME numbers, names and dates, then compare with the paired-shot gate. Dates are relative to the export day (2026-10-06 IST): "today" in Pallav = the day it is viewed, so re-run the capture on the same day, or shift dates in the mock by the difference.

Pallav pages for each fixture: bills/advances = `bill_master_bills`, `bill_master_advances`; Revenue = `hotel_cash_deposits`, `food_cash_deposits`; Expenses = withdrawals + misc expenses + `staff_advances`; Shift Handover = `shift_handovers`; Front Desk = `pms_rooms`, `pms_stays`, `pms_reservations`, `pms_charges`, `site_rooms` (room types); Companies = `company_profiles`; Payroll = `payroll_companies`, `employees`, `salary_processings`, `attendance_*`, `payroll_advances`, `bonus_incentives`, `deductions`.
Re-export (after changing the scratch data): `php export-fixtures.php <outdir>` in the scratch folder.
