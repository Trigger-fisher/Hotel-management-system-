import { productName } from "@shared/auth/copy";

// The full brand logo (public/brand/logo-day.svg by day, logo-night.svg when the device is in dark mode), cropped to its artwork by globals.css .hms-brand-logo.
export function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    // the large logo heads the sign-in page's narrow left column on a tablet: the wider night artwork is drawn smaller there, so it is not cut
    <span className={`hms-brand-logo hms-brand-logo-${size}${size === "lg" ? " md:max-lg:dark:[--lh:40px]!" : ""}`} role="img" aria-label={productName}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file of the site, cropped by CSS */}
      <img className="hms-logo-day" src="/brand/logo-day.svg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file of the site, cropped by CSS */}
      <img className="hms-logo-night" src="/brand/logo-night.svg" alt="" />
    </span>
  );
}
