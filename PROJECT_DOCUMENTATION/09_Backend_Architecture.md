# 09. Backend Architecture & Execution Flow

## 1. Architectural Pattern

The backend of HMS is structured around a **Layered Architecture** with strict dependency rules:

```
[HTTP Request]
       │
       ▼
[Next.js App Router API Route Handler]  (web-app/src/app/api/v1/*)
       │
       ▼
[HTTP Wrapper & Middleware]            (web-app/src/server/http/wrapper.ts)
  ├── Rate Limiter (IP & Account)
  ├── Session Resolver (__Host- cookie / API Token)
  ├── Visit Access Checker
  └── Idempotency Guard (Idempotency-Key)
       │
       ▼
[Service Compose Factory]              (web-app/src/server/compose/*)
  ├── createPgUnit(session)            (Creates DB client & sets tenant schema)
  └── createMemoryUnit(session)        (In-memory fallback for mock mode)
       │
       ▼
[Domain Services]                      (web-app/src/server/services/*)
  └── Encapsulates core business rules, calculations, and domain logic
       │
       ▼
[Repository Layer]                     (web-app/src/server/repos/*)
  ├── Postgres Repositories            (Native SQL queries with parameterized inputs)
  └── Memory Repositories              (Mock fixtures for isolated dev/testing)
       │
       ▼
[PostgreSQL Database]                  (Multi-tenant schemas: platform & hotel_*)
```

## 2. Multi-Tenant Request Isolation (`createPgUnit`)

Every database operation runs within an isolated unit of work managed by `createPgUnit` in `web-app/src/server/compose/unit.ts`:

1. A connection is acquired from the `pg.Pool` authenticated as `hms_app`.
2. A database transaction begins: `BEGIN`.
3. If the request belongs to a hotel context (`session.hotel.id`):
   ```sql
   SET LOCAL ROLE hotel_<hotel_id>_role;
   SET LOCAL search_path TO hotel_<hotel_id>, platform, public;
   ```
4. If the request is a read-only visit from an administrator:
   ```sql
   SET TRANSACTION READ ONLY;
   ```
5. The domain service executes repository calls. All table references without schema qualifiers automatically resolve to the hotel's private schema.
6. Upon completion, the transaction commits (`COMMIT`), and the connection resets its role before returning to the pool.

## 3. Financial Integrity & Paise Representation

To prevent floating-point rounding errors common in monetary systems, **all currency values are stored as integers representing paise** (1 Rupee = 100 Paise).
- `10000` in the database = `Rs 100.00`.
- Conversions occur only at the formatting layer (`common/ui-shared/dashboards/format.ts`).
- GST calculations are performed using integer arithmetic with standard half-up rounding rules.

## 4. Idempotency Engine

For critical financial transactions (bill settlement, advance payment, refund), the client submits an `Idempotency-Key` header.
- The server checks `platform.idempotency_keys` or the hotel's idempotency store.
- If the key was already processed, the cached response is immediately returned without re-executing the financial mutation.
- Prevents double-billing caused by network retries or double-clicks.
