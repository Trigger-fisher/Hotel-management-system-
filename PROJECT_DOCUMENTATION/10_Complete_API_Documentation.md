# 10. Complete API Documentation & Route Inventory

HMS provides **624 individual API route endpoints** implemented in `web-app/src/app/api/v1`.

## 1. API Categorization Summary

| Module Category | Endpoint Count | Primary Responsibilities |
|---|---|---|
| **Authentication (`/auth/`)** | 12 | Sign-in, sign-out, session verification, OTP challenge, password change |
| **Front Office (`/front-office/`)** | 86 | Room board matrix, reservations, check-in, stays, room state, guest requests |
| **Billing (`/billing/`)** | 94 | Invoices, folios, advances, refunds, settling, PDF streaming, purge |
| **Cash Book (`/cash/`)** | 38 | Revenue book, miscellaneous expense ledger, shift cashier handover |
| **Companies (`/companies/`)** | 42 | Corporate profiles, credit statements, ledger reconciliation, GST lookup |
| **Staff & Payroll (`/payroll/`)** | 78 | Employee directory, attendance recording, salary generation, payslips |
| **Hotel Administration (`/admin/`)** | 114 | Hotel settings, masters/rates, users, roles, backup, Razorpay config |
| **Platform Console (`/platform/`)** | 98 | Hotel directory, groups, onboarding, vault secrets, security audit, health |
| **Unified Messages (`/conversations/`)** | 46 | Email inbox, WhatsApp threads, message sending, attachments |
| **Website & CMS (`/website/`)** | 32 | Hotel website content, photo gallery, nearby attractions, enquiry booking |
| **Public & Webhooks (`/public/`, `/webhooks/`)** | 24 | Razorpay webhooks, Amazon SES/SNS mail webhooks, canary traps |

---

## 2. Key API Specifications

### 2.1 Sign-In Endpoint
- **URL**: `POST /api/v1/auth/sign-in`
- **Auth Required**: None (Public)
- **Request Body**:
  ```json
  {
    "identifier": "receptionist@pallav.com",
    "password": "SecretPassword123",
    "device": {
      "platform": "web",
      "name": "Chrome on Windows"
    }
  }
  ```
- **Responses**:
  - `200 OK` (Signed In):
    ```json
    {
      "ok": true,
      "data": {
        "status": "signed_in",
        "session": {
          "accessToken": "eyJhbGciOi...",
          "accessTokenExpiresAt": "2026-11-04T12:00:00Z",
          "user": {
            "id": "usr_0192a...",
            "displayName": "Ramesh Kumar",
            "role": "hotel_user",
            "hotel": { "id": "htl_01a...", "name": "Hotel Pallav" }
          }
        }
      }
    }
    ```
  - `200 OK` (Two-Factor Challenge Required):
    ```json
    {
      "ok": true,
      "data": {
        "status": "two_factor_required",
        "challengeId": "chl_01a...",
        "maskedEmail": "r******@p*****.com"
      }
    }
    ```
  - `401 Unauthorized` / `429 Too Many Requests`: Account locked after 5 failed attempts.

### 2.2 Room Board Status
- **URL**: `GET /api/v1/front-office/board`
- **Auth Required**: Bearer token / Session cookie (Role: `hotel_admin`, `hotel_user`)
- **Query Parameters**: `floor` (optional), `date` (ISO date)
- **Response**:
  ```json
  {
    "ok": true,
    "data": {
      "rooms": [
        {
          "id": "rm_101",
          "number": "101",
          "category": "Deluxe Double",
          "status": "occupied",
          "guestName": "Vikram Patel",
          "stayId": "sty_982",
          "checkIn": "2026-11-02",
          "expectedCheckOut": "2026-11-05",
          "balancePaise": 450000
        }
      ]
    }
  }
  ```

### 2.3 Settle Bill
- **URL**: `POST /api/v1/billing/bills/{id}/settle`
- **Headers**: `Idempotency-Key: <UUID>`
- **Request Body**:
  ```json
  {
    "paymentMethod": "upi",
    "receivedPaise": 525000,
    "transactionReference": "UPI/234982734"
  }
  ```
- **Response**:
  ```json
  {
    "ok": true,
    "data": {
      "billId": "bil_8723",
      "billNumber": "INV-2026-089",
      "status": "settled",
      "settledAt": "2026-11-04T11:15:00Z",
      "pdfUrl": "/api/v1/billing/bills/bil_8723/pdf"
    }
  }
  ```
