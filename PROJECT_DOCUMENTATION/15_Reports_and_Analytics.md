# 15. Reports & Analytics Engine

HMS provides standardized operational, financial, and tax compliance reports:

## 1. Daily Operational Report (`hotel.reports.daily`)
- **Purpose**: End-of-day reconciliation for property managers and owners.
- **Metrics Tracked**:
  - Total Room Revenue (Paise & Rupee format).
  - Food & Beverage Revenue.
  - Advance Collections vs Advance Adjusted.
  - Cash Drawer Opening, Inflow, Outflow, and Closing Balance.
  - Total Available Rooms, Occupied Rooms, Complimentary Rooms, Out-of-Order Rooms.
  - Occupancy Percentage:
    $$	ext{Occupancy \%} = rac{	ext{Occupied Rooms}}{	ext{Total Saleable Rooms}} 	imes 100$$
- **Exports**: Immediate PDF generation via `pdfkit`.

## 2. GST Tax Summary Report (`hotel.reports.gst`)
- **Purpose**: Statutory compliance for monthly GST filing (GSTR-1 and GSTR-3B).
- **Tax Slabs Breakdown**:
  - 0% Exempt Room Charges.
  - 5% GST (2.5% CGST + 2.5% SGST) on Food & Restaurant Services.
  - 12% GST (6% CGST + 6% SGST) on Rooms with tariff < Rs 7,500.
  - 18% GST (9% CGST + 9% SGST) on Rooms with tariff >= Rs 7,500.
- **Exports**: CSV export formatted for direct tally / accountant ingestion, and printable PDF.

## 3. Shift Cashier Handover Report (`hotel.cash.handover`)
- **Purpose**: Prevents cash leakage between front-office shifts.
- **Audit Points**: Physical denomination breakdown, logged cashier username, shift hand-over timestamp, system expected balance, and recorded variance notes.
