import { aboutPage as p } from "@shared/site/pages";
import { CtaBand, PageIntro } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's About page: why the product exists and what it stands for.
export const metadata = sitePageMetadata(p.meta);

export default function AboutPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <section className="hp-section hp-section-sm hp-tint">
        <div className="hp-wrap hp-about">
          {p.sections.map((s) => (
            <div key={s.title}>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="hp-section hp-section-sm">
        <div className="hp-wrap">
          <div className="hp-cards hp-cards-3">
            {p.values.map((v) => (
              <article key={v.title} className="hp-card">
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </SiteShell>
  );
}
