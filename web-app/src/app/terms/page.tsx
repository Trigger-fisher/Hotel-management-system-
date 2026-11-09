import { termsPage as p } from "@shared/site/pages";
import { LegalPage } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's terms of service.
export const metadata = sitePageMetadata(p.meta);

export default function TermsPage() {
  return (
    <SiteShell>
      <LegalPage title={p.title} updated={p.updated} intro={p.intro} sections={p.sections} />
    </SiteShell>
  );
}
