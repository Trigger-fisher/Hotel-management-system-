'use client';

// The one footer line (Shared Component): the product's copyright from the shared copy, optional links on the same line.
//   <Footer />   <Footer links={[{ label: 'Terms', href: '/terms' }]} />
// Used under public pages, the sign-in family and the onboarding flow; text colour is a token, size is the caption size.
import { copy as authCopy, fill } from '@shared/auth/copy';

export interface FooterLink {
  label: string;
  href: string;
}

export function Footer({ links = [], year = new Date().getFullYear(), className = '' }: { links?: FooterLink[]; year?: number; className?: string }) {
  return (
    <footer className={`hms-footer text-center fs-sm text-muted ${className}`.trim()}>
      <p className="mb-0">{fill(authCopy.brand.copyright, { year })}</p>
      {links.length > 0 && (
        <p className="mb-0 mt-1">
          {links.map((l, i) => (
            <span key={`${l.label}|${l.href}`}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <a className="t-link" href={l.href}>{l.label}</a>
            </span>
          ))}
        </p>
      )}
    </footer>
  );
}
