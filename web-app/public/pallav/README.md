# Vendored styles for the dashboard (Hotel Pallav look)

These files are copied unchanged from the Hotel Pallav account system (the Laravel app, GitHub `Mihir-Jungiwala/hotel-pallav-account`,
`public/assets/*.css`), plus:

- `bootstrap.min.css`: Bootstrap 5.3.3 (MIT, https://getbootstrap.com). CSS only; no Bootstrap JavaScript is used.
- `bootstrap-icons.css` and `fonts/`: Bootstrap Icons 1.11.3 (MIT, https://icons.getbootstrap.com).
- `vendor/`: flatpickr 4.6.13 and its monthSelect plugin (MIT, https://flatpickr.js.org) and Tom Select 2.3.1 (Apache-2.0, https://tom-select.js.org), the same versions and files Pallav loads from jsDelivr; shipped here so no third party is called. Their scripts load only when a date or select field is first shown.
- `layout.css`: the `<style>` block of Pallav's `resources/views/layouts/app.blade.php` (tokens, rail, subnav, topbar layout).

They are loaded only while the dashboard is open (`src/dashboards/pallav/assets.ts`) and removed again on sign-out, so the login
screens keep their own styles. Do not edit these files: Pallav parity means Pallav's own rules. Changes we need (calm motion,
the fonts our app loads) go in `hms-overrides.css`.

Pallav's CSS is the property of its owner (MJ); Bootstrap and Bootstrap Icons are MIT licensed.
