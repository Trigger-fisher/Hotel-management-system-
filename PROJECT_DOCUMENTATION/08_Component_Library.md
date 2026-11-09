# 08. Reusable Component Library

The application utilizes modular UI components residing in `web-app/src/dashboards/shell/`, `web-app/src/components/`, and `web-app/src/dashboards/pallav/ui/`.

## 1. Shell Components

### 1.1 `RoleDashboard.tsx`
- **Location**: `web-app/src/dashboards/shell/RoleDashboard.tsx` (57 KB)
- **Purpose**: The master host component for all authenticated dashboard panels.
- **Responsibilities**:
  - Reads active route view ID from URL query param `?view=`.
  - Determines dashboard role type (`hotel`, `platform`, `group`, `guest`, `corporate`).
  - Renders the responsive desktop sidebar, mobile bottom tab-bar, and top header bar.
  - Dynamically mounts the appropriate screen component from `src/dashboards/groups/*`.
  - Handles real-time unread conversation counts and attention alerts.

### 1.2 `PhoneSearch.tsx`
- **Location**: `web-app/src/dashboards/shell/PhoneSearch.tsx`
- **Purpose**: Global omni-search modal (`/` or `Ctrl+K`).
- **Features**: Live typeahead searching across guests, rooms, invoices, and companies with keyboard shortcut navigation.

### 1.3 `AttentionBell.tsx`
- **Location**: `web-app/src/dashboards/shell/AttentionBell.tsx`
- **Purpose**: Notification bell tracking pending check-outs, unassigned emails, guest requests, and cashier cash variance alerts.

### 1.4 `Notch.tsx`
- **Location**: `web-app/src/dashboards/shell/Notch.tsx`
- **Purpose**: Dynamic top notification notch displaying platform-wide system status, offline indicators, and real-time alerts.

---

## 2. Common Data & Input Components

### 2.1 Flatpickr Date Picker
- **Implementation**: Wrapped React hook around Flatpickr.
- **Usage**: Check-in/check-out date selection, salary month selection, daily report date range filters.
- **Formats**: Display format `DD MMM YYYY` (e.g., `04 Nov 2026`).

### 2.2 Tom Select Dropdown
- **Implementation**: Searchable select input wrapper.
- **Usage**: Company assignment in room booking, role selection in user management, meal plan selector.

### 2.3 Status Pills (`Pill.tsx`)
- Standardized badges rendering the status of rooms, invoices, and employees:
  - `.pill-success`: Confirmed, Settled, Clean.
  - `.pill-warning`: In-Progress, Pending, Due.
  - `.pill-danger`: Cancelled, Out-of-Order, Suspended.
  - `.pill-info`: In-House, Scheduled.

### 2.4 Document PDF Viewer Modal
- **Purpose**: In-app preview of generated invoice and pay-slip PDFs.
- **Controls**: Print directly, download file, or send as email attachment without leaving the dashboard view.
