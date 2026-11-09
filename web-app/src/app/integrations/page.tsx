import { integrationsPage as p } from "@shared/site/pages";
import { CtaBand, PageIntro } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's Integrations page: what is connected today and what is coming, each marked.
export const metadata = sitePageMetadata(p.meta);

export default function IntegrationsPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <section className="hp-section hp-section-sm hp-tint">
        <div className="hp-wrap hp-int">
          {p.groups.map((g) => (
            <div key={g.title} className="hp-int-group">
              <h2>{g.title}</h2>
              <div className="hp-cards hp-cards-int">
                {g.items.map((it) => (
                  <article key={it.name} className="hp-card">
                    <span className={`hp-badge${it.status === "live" ? " hp-badge-live" : ""}`}>{it.status === "live" ? p.live : p.soon}</span>
                    <h3>{it.name}</h3>
                    <p>{it.body}</p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <CtaBand />
    </SiteShell>
  );
}
