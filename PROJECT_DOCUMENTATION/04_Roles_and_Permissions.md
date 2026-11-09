# 04. Roles, Permissions & Access Control Architecture

## 1. System Roles

The system defines exactly 7 roles in `common/ui-shared/auth/types.ts`:

| Role Key | Name | Hierarchy Level | Target Panel | Scope of Authority |
|---|---|---|---|---|
| `super_admin` | Super Administrator | Level 1 (Apex) | Platform Console / Hotel | Total system control across all hotels, groups, platform settings, security vault, and backups. |
| `platform_admin` | Platform Administrator | Level 2 | Platform Console | Day-to-day platform operations, hotel approvals, invitations, and onboarding (restricted from vault and server configs). |
| `group_hotel_admin` | Group Hotel Administrator | Level 3 | Group Console | Oversees a specific group of affiliated member hotels (e.g., Sunrise Group). |
| `hotel_admin` | Hotel Administrator | Level 4 | Hotel Dashboard | Full operational control of their specific hotel tenant (users, roles, settings, masters, financial books). |
| `hotel_user` | Hotel Staff / User | Level 5 | Hotel Dashboard | Day-to-day operations (reception, front desk, billing, cashbook) capped by assigned role permissions. |
| `corporate_user` | Corporate / Company User | Level 6 | Corporate Portal | Business accounts: view company stay history, bills, corporate rates, and statements. |
| `guest_user` | Guest User | Level 7 | Guest Portal | Individual guests: view personal stay bills, payment receipts, and place room-service orders. |

## 2. Granular Permission Catalog (RBAC)

Within a hotel tenant, fine-grained access control is governed by the Permission Catalog defined in `web-app/src/server/auth/catalog.generated.ts`. 

Permissions are categorized into:
- **Modules**: High-level functional areas (e.g., `revenue`, `bills`, `pms`, `payroll`).
- **Parts**: Specific functional sub-areas under a module (e.g., `bills.advances`, `bills.bills`, `pms.board`, `pms.reservations`).
- **Abilities**: Binary administrative switches (e.g., `users.password`, `users.set-password`).

### Permission Levels

Each permission part offers one of 4 hierarchical levels:
1. `view` (Rank 1): Read-only access to lists, details, and PDF preview.
2. `create` (Rank 2): Ability to create new records (cannot edit existing records).
3. `edit` (Rank 3): Ability to update existing records.
4. `full` (Rank 4): Complete authority including record deletion, purging, and status overrides.

### Permission Engine Logic

The effective level of a user on any action is computed as:
$$	ext{Effective Level} = \min(	ext{Granted Level}, 	ext{Offered Level})$$
A user can never perform an action exceeding the capability offered by that specific module part.

## 3. Role vs Module Permission Matrix

| Module / Area | Super Admin | Platform Admin | Group Admin | Hotel Admin | Hotel User (Default Editor) | Hotel User (Viewer) | Corporate User | Guest User |
|---|---|---|---|---|---|---|---|---|
| **Platform Settings & Vault** | Full | Denied | Denied | Denied | Denied | Denied | Denied | Denied |
| **Hotel Onboarding & Creation** | Full | Full | Denied | Denied | Denied | Denied | Denied | Denied |
| **Group Multi-Hotel Overview** | Full | Full | Full | Denied | Denied | Denied | Denied | Denied |
| **Hotel Settings & Master Rates** | Full (via visit) | Denied | Denied | Full | Denied | Denied | Denied | Denied |
| **Front Desk / Room Board** | Full | Denied | View (visit) | Full | Edit / Full | View | Denied | Denied |
| **Billing & Invoices** | Full | Denied | View (visit) | Full | Edit | View | Denied | Denied |
| **Cash Book & Handover** | Full | Denied | Denied | Full | Edit | View | Denied | Denied |
| **Staff Payroll & Salaries** | Full | Denied | Denied | Full | Edit | View | Denied | Denied |
| **Email & WhatsApp Inbox** | Denied (private) | Denied (private) | View (visit) | Full | Edit | View | Denied | Denied |
| **Company Corporate Portal** | Denied | Denied | Denied | Denied | Denied | Denied | Full (Own) | Denied |
| **Guest Self-Service Portal** | Denied | Denied | Denied | Denied | Denied | Denied | Denied | Full (Own) |

## 4. Multi-Tenant Authorization Enforcement

1. **Session-Bound Identity**:
   Every incoming request parses the session cookie `__Host-hms-session`. The server extracts `userId`, `role`, and `hotelId`. The client can never supply an arbitrary `hotel_id` query parameter to switch tenant contexts.
2. **Platform "Enter Hotel" Visit Control**:
   When a Super Administrator visits a hotel to troubleshoot, the system issues a temporary, audited **Visit Session** (`session.visit`).
   - A `view` visit establishes a read-only database transaction (`BEGIN READ ONLY`).
   - A `full` visit allows operational edits but explicitly denies access to payment keys, backup configs, and password reset endpoints.
