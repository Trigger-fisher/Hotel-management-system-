# 16. Desktop Application Conversion Requirements & Specification

This document provides the technical blueprint for developing the **Desktop Application** version of HMS (`desktop-app/`).

## 1. Desktop Architecture Evaluation

| Criterion | Electron | Tauri 2.0 (Recommended) | Native (C# / WPF or Qt) |
|---|---|---|---|
| **Binary Footprint** | ~120 MB - 180 MB | **~10 MB - 25 MB** | ~30 MB - 60 MB |
| **Memory Consumption** | High (~250 MB - 500 MB RAM) | **Low (~35 MB - 80 MB RAM)** | Minimal (~40 MB RAM) |
| **Web Code Reuse** | 100% React/TSX reuse | **100% React/TSX reuse** | 0% (Total rewrite required) |
| **Hardware Access** | Node.js native bindings | **Rust native plugins / OS APIs** | Native C++/C# libraries |
| **Startup Speed** | Moderate (~2-4 seconds) | **Instant (~300-600 ms)** | Instant |
| **Security Sandbox** | Complex to harden | **Strict Rust IPC & capability system** | Native OS security |

### Recommended Architecture: Tauri 2.0 (Rust) + Next.js (SSG/Client SPA)
- **Frontend Layer**: Reuses the entire existing TSX dashboard components, design tokens, and Pallav CSS layers compiled in static/SPA mode.
- **Backend / Core Layer**: Rust-based Tauri backend executing high-speed system commands, native peripheral management, and local SQLite caching.

---

## 2. Desktop UI & Window Specifications

- **Default Launch Window**: `1366 x 768` pixels (optimized for standard hotel front-desk POS terminals).
- **Minimum Supported Window**: `1024 x 600` pixels (prevents UI breakage on low-resolution monitors).
- **Custom Frameless Title Bar**: Native window controls (Minimize, Maximize, Close) styled in the graphite ink theme with embedded hotel selector and internet connection status badge.
- **Multi-Monitor Support**: Capability to pop out the **Room Board** onto a dedicated secondary monitor while retaining billing controls on the primary screen.

---

## 3. Native Hardware Peripheral Integration

1. **POS Thermal Receipt Printers (ESC/POS)**:
   - Direct USB and network raw printing for advance receipts, dining KOT (Kitchen Order Tickets), and bill summaries on 80mm / 58mm thermal rolls.
   - Eliminates standard browser print dialogs via silent background spooling.
2. **Cash Drawer Control**:
   - Pulse command sent to the thermal printer RJ11 port to automatically trigger cash drawer opening upon bill settlement or cash deposit.
3. **Barcode & QR Code Scanners**:
   - Native input hook capturing USB HID keyboard wedge barcode scanners for scanning guest booking confirmation vouchers and ID barcodes.
4. **Passport & ID Flatbed Scanners**:
   - TWAIN / WIA interface integration allowing single-click document capture directly into the check-in modal.

---

## 4. Offline Functionality & Local SQLite Cache

To guarantee 100% front-desk continuity during internet or cloud outages:
- **Local Embedded Database**: SQLite embedded inside the desktop application binary.
- **Cached Datasets**: Active room board state, in-house guest roster, and restaurant menu items are synced locally.
- **Offline Mutation Queue**: If the internet disconnects, check-in records, advance receipts, and restaurant orders are stored in a local SQLite queue and cryptographically replayed to the cloud API upon reconnection.

---

## 5. Existing Web vs Desktop Comparison

| Feature | Existing Web App | Desktop Application Target |
|---|---|---|
| **Receipt Printing** | Browser print dialog (PDF) | Direct silent ESC/POS thermal printing |
| **Cash Drawer** | Manual key opening | Automated trigger via printer pulse |
| **Internet Dependency** | 100% online required | Offline room board & mutation queue |
| **Session Security** | Browser Cookie (`__Host-`) | Encrypted OS Keyring (Windows Credential Guard / Mac Keychain) |
| **Software Updates** | Cloud deployment | Background delta auto-updater |
| **Hardware Scanning** | Mobile camera uploads | Native USB HID & TWAIN scanner integration |
