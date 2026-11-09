import { siteCopy as c } from "@shared/site/copy";
import { contactPage as p } from "@shared/site/pages";
import { ContactForm } from "@/components/site/ContactForm";
import { PageIntro } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's demo request page: the form (saved to platform.demo_requests; the Super Admin sees it in Demo requests), what happens next, and the email address.
export const metadata = sitePageMetadata(p.meta);

export default function ContactPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <section className="hp-section hp-section-sm hp-tint">
        <div className="hp-wrap hp-contact">
          <ContactForm />
          <aside className="hp-contact-side">
            <h2>{p.next.title}</h2>
            <ol className="hp-next">
              {p.next.items.map((it, i) => <li key={it}><span className="hp-step-no">{i + 1}</span>{it}</li>)}
            </ol>
            <h2>{p.emailTitle}</h2>
            <p><a className="hp-link" href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a></p>
          </aside>
        </div>
      </section>
    </SiteShell>
  );
}
