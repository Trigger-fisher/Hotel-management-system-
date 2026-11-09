# 14. Business Logic & Core Workflows

## 1. Walk-in Guest Check-In Workflow

```mermaid
sequenceDiagram
    actor Receptionist
    participant UI as Room Board UI
    participant Server as API Handler
    participant DB as Hotel Schema DB

    Receptionist->>UI: Select Vacant Room & Click "Walk-in Check-in"
    UI->>Receptionist: Open Check-in Modal Form
    Receptionist->>UI: Input Mobile, Name, ID Proof, Tariff & Advance
    UI->>Server: POST /api/v1/front-office/stays
    Server->>DB: Check room state is 'vacant_clean'
    Server->>DB: INSERT INTO stays (room_id, guest_name, check_in_time, status)
    Server->>DB: UPDATE rooms SET status = 'occupied'
    Server->>DB: INSERT INTO advances (amount_paise, payment_mode)
    Server-->>UI: Return 200 OK (Stay ID & Receipt)
    UI->>Receptionist: Show Room as Occupied (Blue) & Print Receipt
```

---

## 2. Invoicing & Bill Settlement Workflow

1. **Charge Accumulation**: During the stay, charges accumulate:
   - Daily room tariff applied automatically by the system.
   - Restaurant dining and room-service orders posted to the stay folio.
   - Miscellaneous charges (laundry, extra bed).
2. **Bill Generation**:
   - The cashier triggers "Generate Bill".
   - The system aggregates all bill lines and calculates taxes:
     $$	ext{CGST} = 	ext{Round}\left(rac{	ext{Taxable Subtotal} 	imes 	ext{CGST \%}}{100}ight)$$
     $$	ext{SGST} = 	ext{Round}\left(rac{	ext{Taxable Subtotal} 	imes 	ext{SGST \%}}{100}ight)$$
     $$	ext{Total Invoice Amount} = 	ext{Subtotal} + 	ext{CGST} + 	ext{SGST}$$
3. **Advance Adjustment**:
   - Prior unadjusted advance deposits linked to the stay are subtracted from the total.
   - $	ext{Net Due} = 	ext{Total Invoice Amount} - 	ext{Advance Adjusted}$.
4. **Settlement**:
   - Cashier collects remaining balance via Cash, Card, or UPI.
   - Submits `POST /api/v1/billing/bills/{id}/settle` with an `Idempotency-Key`.
   - Room status shifts to `vacant_dirty`.
   - Streaming PDF Tax Invoice is compiled and printed.
